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
  } catch {
    return NextResponse.json({ error: "Form data invalido" }, { status: 400 });
  }

  if (!image) {
    return NextResponse.json({ error: "Falta el campo 'image'" }, { status: 400 });
  }

  // Limite de tamanio: OCR.space plan free acepta hasta 1MB por imagen.
  // Si el browser manda una foto muy grande, devolvemos error claro.
  if (image.size > 1024 * 1024) {
    return NextResponse.json(
      {
        error:
          "La imagen pesa más de 1MB. Reduce la resolucion antes de enviar (el componente del browser ya reduce, si ves este error reporta).",
      },
      { status: 413 },
    );
  }

  // OCR.space acepta multipart/form-data con:
  //  - file: la imagen
  //  - language: "spa" funciona bien para docs en espanol; el motor nuevo
  //    (OCREngine=2) detecta mejor MRZ.
  //  - isOverlayRequired: false (no necesitamos coords por ahora)
  //  - OCREngine: 2 (modelo ML mejor que el engine 1)
  //  - detectOrientation: true (gira automaticamente si la foto esta torcida)
  //  - scale: true (upscale para textos pequenios — util para MRZ)
  const ocrForm = new FormData();
  ocrForm.append("file", image, image.name || "scan.jpg");
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
      // signal: un timeout para no quedarnos colgados si OCR.space se cuelga.
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          error: `OCR.space devolvio ${res.status}. Probablemente rate limit o imagen invalida.`,
        },
        { status: 502 },
      );
    }
    ocrResp = (await res.json()) as OcrSpaceResponse;
  } catch (err) {
    return NextResponse.json(
      {
        error: `No se pudo conectar a OCR.space: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 },
    );
  }

  if (ocrResp.IsErroredOnProcessing) {
    const msg = Array.isArray(ocrResp.ErrorMessage)
      ? ocrResp.ErrorMessage.join("; ")
      : ocrResp.ErrorMessage ?? "Error desconocido";
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
      {
        error:
          "OCR.space no detecto texto en la imagen. Asegurate de que el documento sea legible y el foco este nitido.",
      },
      { status: 422 },
    );
  }

  const parsed = await parseDocumentText(rawText);
  return NextResponse.json({ ok: true, doc: parsed });
}
