/**
 * Gemini 2.5 Flash-Lite — OCR de documentos de identidad.
 *
 * Helper puro que consume Gemini via REST API. Usado por:
 *  - /api/ocr/scan-document (dashboard del host, escanea al crear reserva)
 *  - /api/checkin/step2      (flujo del huesped, sin sesion)
 *
 * GEMINI_API_KEY vive en env var server-side. Free tier Google AI Studio
 * 1500 requests/dia.
 */

const GEMINI_MODEL = "gemini-2.5-flash-lite";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const EXTRACTION_PROMPT = `Analiza este documento de identidad (pasaporte, cedula, licencia, o similar) y extrae los siguientes campos:

- guestName: nombre completo del titular en Title Case (ej "Juan Carlos Perez Gomez")
- docNumber: numero de documento tal cual aparece (pasaporte suele ser alfanumerico; cedula dominicana es 000-0000000-0)
- nationality: codigo ISO 3166-1 alpha-3 de la nacionalidad (DOM, USA, ESP, MEX, COL, ARG, VEN, BRA, CHL, PER, CUB, HTI, CAN, FRA, DEU, ITA, GBR, CHN, JPN, KOR, RUS, etc.)
- dateOfBirth: fecha de nacimiento en formato YYYY-MM-DD si es legible
- expirationDate: fecha de vencimiento en formato YYYY-MM-DD si aparece
- language: idioma principal del documento en codigo ISO 639-1 (es, en, fr, zh, ar, ru, etc.)
- confidence: tu nivel de confianza 0.0-1.0 sobre la legibilidad de la foto

Si un campo no es legible o no aplica, omitilo del JSON (no inventes).
Si la imagen NO es un documento de identidad, responde {"error": "no-document"}.
Si la foto esta borrosa, oscura, o cortada, responde con confidence baja (< 0.5).

Responde SOLO con JSON valido. Nada de markdown, explicaciones, o texto antes/despues.`;

export type OcrResult = {
  ok: boolean;
  doc?: {
    guestName?: string;
    docNumber?: string;
    nationality?: string;
    dateOfBirth?: string;
    expirationDate?: string;
    language?: string;
    confidence?: number;
    rawText: string;
  };
  error?: string;
  status?: number;
};

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
};

export async function scanDocumentWithGemini(
  imageBase64: string,
  mimeType: string,
): Promise<OcrResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "GEMINI_API_KEY no configurada", status: 500 };
  }

  const body = {
    contents: [
      {
        parts: [
          { text: EXTRACTION_PROMPT },
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
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
      return { ok: false, error: `Gemini ${res.status}: ${errBody.slice(0, 200)}`, status: 502 };
    }
    gemResp = (await res.json()) as GeminiResponse;
  } catch (err) {
    return {
      ok: false,
      error: `No se pudo conectar a Gemini: ${err instanceof Error ? err.message : String(err)}`,
      status: 502,
    };
  }

  if (gemResp.error) {
    return { ok: false, error: gemResp.error.message ?? "Gemini error", status: 502 };
  }

  const rawText = gemResp.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  if (!rawText) {
    return { ok: false, error: "Gemini no devolvio contenido", status: 422 };
  }

  let extracted: Record<string, unknown>;
  try {
    extracted = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    return { ok: true, doc: { rawText } };
  }

  if (extracted.error === "no-document") {
    return { ok: false, error: "La imagen no parece ser un documento de identidad", status: 422 };
  }

  return {
    ok: true,
    doc: {
      guestName: extracted.guestName as string | undefined,
      docNumber: extracted.docNumber as string | undefined,
      nationality: (extracted.nationality as string | undefined)?.toUpperCase(),
      dateOfBirth: extracted.dateOfBirth as string | undefined,
      expirationDate: extracted.expirationDate as string | undefined,
      language: extracted.language as string | undefined,
      confidence: typeof extracted.confidence === "number" ? extracted.confidence : undefined,
      rawText,
    },
  };
}
