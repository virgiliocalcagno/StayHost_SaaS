/**
 * POST /api/ocr/scan-document
 *
 * Endpoint del dashboard del host para escanear documentos al crear
 * reservas manualmente. Usa la helper `scanDocumentWithGemini`.
 * Requiere sesion de host. (Version del huesped sin sesion en /api/checkin/step2)
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
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
    const result = await scanDocumentWithGemini(base64, image.type || "image/jpeg");

    if (!result.ok || !result.doc) {
      return NextResponse.json(
        { error: result.error ?? "Error en OCR" },
        { status: result.status ?? 500 },
      );
    }

    const doc: ScannedDoc = {
      guestName: result.doc.guestName,
      docNumber: result.doc.docNumber,
      nationality: result.doc.nationality,
      dateOfBirth: result.doc.dateOfBirth,
      expirationDate: result.doc.expirationDate,
      source: "gemini",
      rawText: result.doc.rawText,
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
