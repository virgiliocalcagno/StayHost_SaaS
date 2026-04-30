/**
 * POST /api/public/hub/[hostId]/scan-document
 *
 * Endpoint PUBLICO (sin sesion) para que el huesped escanee su documento
 * desde el Hub al hacer una solicitud de reserva. Misma seguridad que la
 * version interna /api/ocr/scan-document:
 *   - Valida que el hostId existe (tenant real).
 *   - Reusa scanDocumentWithGemini (mismo Gemini Flash-Lite que el host).
 *   - Sube la foto al bucket `checkin-ids` con admin key, scopeada bajo
 *     `{tenantId}/hub-requests/{uuid}.jpg`. Asi el host la ve igual que las
 *     fotos de check-in del huesped (auditoría en un solo lugar).
 *
 * Anti-abuso minimo:
 *   - Limite 10MB por imagen (igual que la version interna).
 *   - Rate limit por IP queda como TODO; por ahora confiamos en que el
 *     formulario del Hub no es facilmente scrapeable y la foto requiere
 *     subida manual.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { scanDocumentWithGemini } from "@/lib/ocr/gemini";

export const maxDuration = 60;

export type PublicScannedDoc = {
  guestName?: string;
  docNumber?: string;
  nationality?: string;
  dateOfBirth?: string;
  expirationDate?: string;
  rawText: string;
  photoPath?: string;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ hostId: string }> }
) {
  try {
    const { hostId } = await params;
    if (!hostId) {
      return NextResponse.json({ error: "hostId required" }, { status: 400 });
    }

    // Validar que el hostId es un tenant real antes de aceptar uploads.
    // Si no existe, no gastamos cuota de Gemini ni espacio en Storage.
    const { data: tenant } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("id", hostId)
      .maybeSingle();
    if (!tenant) {
      return NextResponse.json({ error: "Hub not found" }, { status: 404 });
    }
    const tenantId = (tenant as { id: string }).id;

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
        { status: 413 }
      );
    }

    const arrayBuffer = await image.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mime = image.type || "image/jpeg";
    const result = await scanDocumentWithGemini(base64, mime);

    if (!result.ok || !result.doc) {
      return NextResponse.json(
        { error: result.error ?? "Error en OCR" },
        { status: result.status ?? 500 }
      );
    }

    // Subimos al bucket bajo {tenantId}/hub-requests/{uuid}. Best-effort:
    // si falla la subida, devolvemos el OCR igual (el huesped puede
    // reintentar en submit).
    let photoPath: string | undefined;
    try {
      const ext = mime.includes("png") ? "png" : "jpg";
      const uuid = crypto.randomUUID();
      const path = `${tenantId}/hub-requests/${uuid}.${ext}`;
      const { error: uploadErr } = await supabaseAdmin.storage
        .from("checkin-ids")
        .upload(path, Buffer.from(arrayBuffer), {
          contentType: mime,
          upsert: false,
        });
      if (!uploadErr) photoPath = path;
      else console.error("[hub/scan-document] upload failed (non-fatal):", uploadErr);
    } catch (uploadErr) {
      console.error("[hub/scan-document] upload threw (non-fatal):", uploadErr);
    }

    const doc: PublicScannedDoc = {
      guestName: result.doc.guestName,
      docNumber: result.doc.docNumber,
      nationality: result.doc.nationality,
      dateOfBirth: result.doc.dateOfBirth,
      expirationDate: result.doc.expirationDate,
      rawText: result.doc.rawText,
      photoPath,
    };
    return NextResponse.json({ ok: true, doc });
  } catch (err) {
    console.error("[hub/scan-document] unhandled:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
