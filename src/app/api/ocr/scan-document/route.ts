/**
 * POST /api/ocr/scan-document
 *
 * Recibe una imagen (multipart/form-data, campo "image") y usa Gemini
 * 2.5 Flash-Lite (vision multimodal) para extraer campos del documento.
 *
 * Por que Gemini (vs OCR.space o Tesseract):
 *  - Entiende contexto: le podes pedir "extrae nombre, doc, nacionalidad"
 *    y devuelve JSON estructurado sin pasar por regex.
 *  - Funciona con fotos imperfectas (angulos, sombras, glare) porque es
 *    un LLM multimodal, no un OCR pixel-por-pixel.
 *  - Free tier de Google AI Studio: 1500 requests/dia en Flash-Lite. El
 *    volumen de StayHost (20-50 scans/mes) entra sin pagar.
 *
 * Seguridad: GEMINI_API_KEY vive en env var server-side. Nunca llega al
 * bundle del browser (mismo patron que TTLOCK_*, TUYA_*, etc.).
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

export const maxDuration = 60;

// Modelo mas barato con vision — perfecto para extraer campos de ID docs.
const GEMINI_MODEL = "gemini-2.5-flash-lite";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const EXTRACTION_PROMPT = `Analiza este documento de identidad (pasaporte, cedula, licencia, o similar) y extrae los siguientes campos:

- guestName: nombre completo del titular en Title Case (ej "Juan Carlos Perez Gomez")
- docNumber: numero de documento tal cual aparece (pasaporte suele ser alfanumerico; cedula dominicana es 000-0000000-0)
- nationality: codigo ISO 3166-1 alpha-3 de la nacionalidad (DOM, USA, ESP, MEX, COL, ARG, VEN, BRA, CHL, PER, CUB, HTI, CAN, FRA, DEU, ITA, GBR, etc.)
- dateOfBirth: fecha de nacimiento en formato YYYY-MM-DD si es legible
- expirationDate: fecha de vencimiento en formato YYYY-MM-DD si aparece

Si un campo no es legible o no aplica, omitilo del JSON (no inventes).
Si la imagen NO es un documento de identidad, responde {"error": "no-document"}.

Responde SOLO con JSON valido. Nada de markdown, explicaciones, o texto antes/despues.`;

type GeminiResponse = {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

type ExtractedDoc = {
  guestName?: string;
  docNumber?: string;
  nationality?: string;
  dateOfBirth?: string;
  expirationDate?: string;
  error?: string;
};

export type ScannedDoc = {
  guestName?: string;
  docNumber?: string;
  nationality?: string;
  dateOfBirth?: string;
  expirationDate?: string;
  source: "gemini";
  rawText: string;
};

export async function POST(req: NextRequest) {
  try {
    const { tenantId } = await getAuthenticatedTenant();
    if (!tenantId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY no configurada en el servidor" },
        { status: 500 },
      );
    }

    let image: File | null;
    try {
      const form = await req.formData();
      const maybeImg = form.get("image");
      image = maybeImg instanceof File ? maybeImg : null;
    } catch (err) {
      console.error("[ocr] formData parse error:", err);
      return NextResponse.json({ error: "Form data invalido" }, { status: 400 });
    }

    if (!image) {
      return NextResponse.json({ error: "Falta el campo 'image'" }, { status: 400 });
    }

    // Gemini acepta inline images hasta ~20MB base64. Ponemos 10MB para
    // no regalar cuota si el cliente manda algo muy grande.
    if (image.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: `La imagen pesa ${Math.round(image.size / 1024)}KB (limite 10MB).` },
        { status: 413 },
      );
    }

    const arrayBuffer = await image.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = image.type || "image/jpeg";

    // response_mime_type "application/json" fuerza salida JSON valida.
    const body = {
      contents: [
        {
          parts: [
            { text: EXTRACTION_PROMPT },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        },
      ],
      generationConfig: {
        response_mime_type: "application/json",
        temperature: 0.1,
        maxOutputTokens: 500,
      },
    };

    let gemResp: GeminiResponse;
    try {
      const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.error(`[ocr] gemini HTTP ${res.status}:`, errBody.slice(0, 500));
        return NextResponse.json(
          { error: `Gemini devolvio ${res.status}: ${errBody.slice(0, 200)}` },
          { status: 502 },
        );
      }
      gemResp = (await res.json()) as GeminiResponse;
    } catch (err) {
      console.error("[ocr] gemini fetch error:", err);
      return NextResponse.json(
        { error: `No se pudo conectar a Gemini: ${err instanceof Error ? err.message : String(err)}` },
        { status: 502 },
      );
    }

    if (gemResp.error) {
      const msg = gemResp.error.message ?? "Error desconocido";
      console.error("[ocr] gemini api error:", msg);
      return NextResponse.json(
        { error: `Gemini reporto error: ${msg}` },
        { status: 502 },
      );
    }

    const rawText = gemResp.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    if (!rawText) {
      return NextResponse.json(
        { error: "Gemini no devolvio contenido. Reintentá con otra foto." },
        { status: 422 },
      );
    }

    let extracted: ExtractedDoc;
    try {
      extracted = JSON.parse(rawText) as ExtractedDoc;
    } catch (err) {
      console.error("[ocr] gemini JSON parse error:", err, "raw:", rawText.slice(0, 300));
      // Si no pudo parsear, devolvemos el raw para que el host lo vea.
      return NextResponse.json({
        ok: true,
        doc: { source: "gemini", rawText } satisfies ScannedDoc,
      });
    }

    if (extracted.error === "no-document") {
      return NextResponse.json(
        { error: "La imagen no parece ser un documento de identidad. Asegurate de que el documento este visible y con buena luz." },
        { status: 422 },
      );
    }

    const doc: ScannedDoc = {
      guestName: extracted.guestName,
      docNumber: extracted.docNumber,
      nationality: extracted.nationality?.toUpperCase(),
      dateOfBirth: extracted.dateOfBirth,
      expirationDate: extracted.expirationDate,
      source: "gemini",
      rawText,
    };

    return NextResponse.json({ ok: true, doc });
  } catch (err) {
    console.error("[ocr] unhandled error:", err);
    return NextResponse.json(
      { error: `Error inesperado: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
