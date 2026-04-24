/**
 * POST /api/ocr/scan-document
 *
 * Endpoint del dashboard del host para escanear documentos al crear
 * reservas manualmente. Usa la helper `scanDocumentWithGemini`.
 * Requiere sesion de host. (Version del huesped sin sesion en /api/checkin/step2)
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { scanDocumentWithGemini } from "@/lib/ocr/gemini";

export const maxDuration = 60;

export type ScannedDoc = {
  guestName?: string;
  docNumber?: string;
  nationality?: string;
  dateOfBirth?: string;
  expirationDate?: string;
  source: "gemini";
  rawText: string;
  // Path en el bucket `checkin-ids` donde guardamos la imagen escaneada
  // para que el huésped no tenga que volver a subir la foto en el check-in.
  photoPath?: string;
};

export async function POST(req: NextRequest) {
  try {
    const { tenantId } = await getAuthenticatedTenant();
    if (!tenantId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
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

    if (image.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: `La imagen pesa ${Math.round(image.size / 1024)}KB (limite 10MB).` },
        { status: 413 },
      );
    }

    const arrayBuffer = await image.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mime = image.type || "image/jpeg";
    const result = await scanDocumentWithGemini(base64, mime);

    if (!result.ok || !result.doc) {
      return NextResponse.json(
        { error: result.error ?? "Error en OCR" },
        { status: result.status ?? 500 },
      );
    }

    // Subimos la imagen al bucket `checkin-ids` para que el huésped la herede
    // en el check-in y no tenga que volver a subir foto. La subida es
    // best-effort: si falla, el OCR igual devuelve los datos.
    let photoPath: string | undefined;
    try {
      const ext = mime.includes("png") ? "png" : "jpg";
      const uuid = crypto.randomUUID();
      const path = `${tenantId}/scans/${uuid}.${ext}`;
      const { error: uploadErr } = await supabaseAdmin.storage
        .from("checkin-ids")
        .upload(path, Buffer.from(arrayBuffer), {
          contentType: mime,
          upsert: false,
        });
      if (!uploadErr) {
        photoPath = path;
      } else {
        console.error("[ocr/scan-document] upload to Storage failed (non-fatal):", uploadErr);
      }
    } catch (uploadErr) {
      console.error("[ocr/scan-document] upload to Storage threw (non-fatal):", uploadErr);
    }

    const doc: ScannedDoc = {
      guestName: result.doc.guestName,
      docNumber: result.doc.docNumber,
      nationality: result.doc.nationality,
      dateOfBirth: result.doc.dateOfBirth,
      expirationDate: result.doc.expirationDate,
      source: "gemini",
      rawText: result.doc.rawText,
      photoPath,
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
