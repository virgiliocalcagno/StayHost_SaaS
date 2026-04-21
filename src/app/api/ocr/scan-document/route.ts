/**
 * POST /api/ocr/scan-document
 *
 * Recibe una imagen (multipart/form-data, campo "image") del browser,
 * la manda a OCR.space (plan free, 25k/mes) y parsea el texto resultante
 * en campos estructurados (nombre, documento, nacionalidad).
 *
 * Por que server-side:
 *  - La API key de OCR.space queda en env var, nunca en el bundle del
 *    browser. Si rotamos por un paid provider, cambio aca y no en el
 *    cliente.
 *  - Permite agregar auth (solo hosts logueados pueden usar), rate limit,
 *    y logs sin tocar el cliente.
 *  - Reuso de parsers (MRZ, cedula) entre este endpoint y cualquier otro
 *    futuro (ej. scan de check-in).
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { parseDocumentText } from "@/lib/ocr/parsers";

// OCR puede tardar 5-10s, margen amplio para fotos grandes.
export const maxDuration = 60;

type OcrSpaceResponse = {
  ParsedResults?: {
    ParsedText?: string;
    ErrorMessage?: string;
    ErrorDetails?: string;
  }[];
  OCRExitCode?: number;
  IsErroredOnProcessing?: boolean;
  ErrorMessage?: string | string[];
  ErrorDetails?: string;
};

export async function POST(req: NextRequest) {
  // Try/catch global para que nunca salga un 500 generico sin mensaje.
  // Cualquier error inesperado (import de mrz, fetch fallido, etc.) se
  // devuelve con detalle y se loguea en Vercel.
  try {
    const { tenantId } = await getAuthenticatedTenant();
    if (!tenantId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const apiKey = process.env.OCR_SPACE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OCR_SPACE_API_KEY no configurada en el servidor" },
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

    // Plan free de OCR.space acepta hasta 1MB. Con el compress del cliente
    // deberia llegar menos, pero chequeamos.
    if (image.size > 1024 * 1024) {
      return NextResponse.json(
        { error: `La imagen pesa ${Math.round(image.size / 1024)}KB (limite 1024KB). Reintenta con menos resolucion.` },
        { status: 413 },
      );
    }

    // Forward a OCR.space. Leemos el File como ArrayBuffer y lo envolvemos
    // en Blob — asi evitamos problemas de compatibilidad entre File del
    // runtime de Node serverless y FormData nativo.
    const arrayBuffer = await image.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: image.type || "image/jpeg" });

    const ocrForm = new FormData();
    ocrForm.append("file", blob, image.name || "scan.jpg");
    ocrForm.append("language", "spa");
    ocrForm.append("isOverlayRequired", "false");
    ocrForm.append("OCREngine", "2");
    ocrForm.append("detectOrientation", "true");
    ocrForm.append("scale", "true");

    let ocrResp: OcrSpaceResponse;
    try {
      const res = await fetch("https://api.ocr.space/parse/image", {
        method: "POST",
        headers: { apikey: apiKey },
        body: ocrForm,
        signal: AbortSignal.timeout(45_000),
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        console.error(`[ocr] ocr.space HTTP ${res.status}:`, bodyText.slice(0, 500));
        return NextResponse.json(
          { error: `OCR.space devolvio ${res.status}: ${bodyText.slice(0, 200)}` },
          { status: 502 },
        );
      }
      ocrResp = (await res.json()) as OcrSpaceResponse;
    } catch (err) {
      console.error("[ocr] fetch error:", err);
      return NextResponse.json(
        { error: `No se pudo conectar a OCR.space: ${err instanceof Error ? err.message : String(err)}` },
        { status: 502 },
      );
    }

    if (ocrResp.IsErroredOnProcessing) {
      const msg = Array.isArray(ocrResp.ErrorMessage)
        ? ocrResp.ErrorMessage.join("; ")
        : ocrResp.ErrorMessage ?? "Error desconocido";
      console.error("[ocr] ocr.space processing error:", msg);
      return NextResponse.json(
        { error: `OCR.space reporto error: ${msg}` },
        { status: 502 },
      );
    }

    const parsedResults = ocrResp.ParsedResults ?? [];
    const rawText = parsedResults
      .map((p) => p.ParsedText ?? "")
      .join("\n")
      .trim();

    if (!rawText) {
      return NextResponse.json(
        { error: "OCR.space no detecto texto. Asegurate de que el documento sea legible y el foco nitido." },
        { status: 422 },
      );
    }

    try {
      const parsed = await parseDocumentText(rawText);
      return NextResponse.json({ ok: true, doc: parsed });
    } catch (err) {
      // Si falla el parser (probablemente import de `mrz` fallando en el
      // runtime), al menos devolvemos el texto crudo — el host lo lee y
      // completa a mano.
      console.error("[ocr] parser error:", err);
      return NextResponse.json({
        ok: true,
        doc: { source: "loose-text", rawText },
      });
    }
  } catch (err) {
    console.error("[ocr] unhandled error:", err);
    return NextResponse.json(
      {
        error: `Error inesperado en el servidor: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 },
    );
  }
}
