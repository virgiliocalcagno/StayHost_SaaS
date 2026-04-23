/**
 * POST /api/checkin/step2
 *
 * Endpoint publico del Paso 2 del checkin v3. Consolida en una sola
 * llamada: subida de foto + OCR con Gemini + datos de contacto +
 * advertencia de consentimiento.
 *
 * Request body:
 *   action="getState" → devuelve el estado actual (flujo adaptativo:
 *                       el frontend muestra solo lo que falta)
 *   action="submit"   → sube foto (si viene) + corre OCR + guarda datos
 *   action="requestAuth" → fallback: marca waiting_for_auth=true cuando
 *                       el OCR no pudo leer y el huesped pide ayuda al host
 *
 * Auth: soft-token del huesped (id del checkin_record + channel_code).
 * NO requiere sesion.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { scanDocumentWithGemini } from "@/lib/ocr/gemini";

export const maxDuration = 60;

type CheckinRow = {
  id: string;
  tenant_id: string;
  guest_name: string | null;
  guest_last_name: string | null;
  guest_email?: string | null;
  guest_whatsapp?: string | null;
  guest_count?: number | null;
  id_photo_path: string | null;
  id_status: string;
  ocr_name?: string | null;
  ocr_document?: string | null;
  ocr_nationality?: string | null;
  ocr_confidence?: number | null;
  ocr_attempts?: number | null;
  waiting_for_auth?: boolean | null;
  auth_reason?: string | null;
  requires_manual_review?: boolean | null;
  consent_accepted_at?: string | null;
  booking_ref?: string | null;
  guest_typed_name?: string | null;
  guest_typed_document?: string | null;
  guest_typed_nationality?: string | null;
  checkin_completed_at?: string | null;
};

async function authGuest(id: string, code: string): Promise<CheckinRow | null> {
  if (!id || !code) return null;
  const { data } = await supabaseAdmin
    .from("checkin_records")
    .select("*")
    .eq("id", id)
    .maybeSingle<CheckinRow>();
  if (!data) return null;
  const credLC = code.toLowerCase().trim();
  // Match directo contra guest_last_name (que el lookup seteo = channel_code lowercased)
  if (data.guest_last_name === credLC) return data;
  // Fallback: matchear contra el channel_code del booking vinculado
  if (data.booking_ref) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: booking } = await (supabaseAdmin.from("bookings") as any)
      .select("channel_code")
      .eq("id", data.booking_ref)
      .maybeSingle();
    const bookingCode = String(
      (booking as { channel_code?: string | null } | null)?.channel_code ?? ""
    )
      .toLowerCase()
      .trim();
    if (bookingCode && bookingCode === credLC) return data;
  }
  return null;
}

function bad(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

function getState(row: CheckinRow) {
  return {
    id: row.id,
    hasPhoto: Boolean(row.id_photo_path),
    photoStatus: row.id_status,
    needsPhoto: !row.id_photo_path || row.id_status === "pending" || row.id_status === "rejected",
    ocr: row.ocr_name
      ? {
          name: row.ocr_name,
          document: row.ocr_document,
          nationality: row.ocr_nationality,
          confidence: row.ocr_confidence,
        }
      : null,
    contact: {
      email: row.guest_email ?? null,
      whatsapp: row.guest_whatsapp ?? null,
      guests: row.guest_count ?? null,
    },
    typed: {
      name: row.guest_typed_name ?? null,
      document: row.guest_typed_document ?? null,
      nationality: row.guest_typed_nationality ?? null,
    },
    needsEmail: !row.guest_email,
    needsWhatsapp: !row.guest_whatsapp,
    needsGuestCount: !row.guest_count,
    waitingForAuth: row.waiting_for_auth ?? false,
    authReason: row.auth_reason ?? null,
    requiresManualReview: row.requires_manual_review ?? false,
    completed: Boolean(row.checkin_completed_at),
    completedAt: row.checkin_completed_at ?? null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const id = String(body.id ?? "");
    const code = String(body.code ?? "");

    const row = await authGuest(id, code);
    if (!row) return bad(401, "No autorizado");

    // ── getState ────────────────────────────────────────────────────────────
    if (action === "getState") {
      // Caso retroactivo: si ya hay foto en Storage pero nunca se corrio OCR
      // (foto subida con la version vieja del uploadId), corremos OCR ahora
      // contra la foto existente para que el huesped vea los datos leidos
      // la proxima vez sin tener que re-subir.
      let currentRow = row;
      if (row.id_photo_path && !row.ocr_name && !row.ocr_document) {
        try {
          const { data: fileData } = await supabaseAdmin.storage
            .from("checkin-ids")
            .download(row.id_photo_path);
          if (fileData) {
            const arrayBuffer = await fileData.arrayBuffer();
            const base64 = Buffer.from(arrayBuffer).toString("base64");
            const mime = fileData.type || "image/jpeg";
            const ocr = await scanDocumentWithGemini(base64, mime);
            if (ocr.ok && ocr.doc) {
              const ocrUpdates: Record<string, unknown> = {
                ocr_raw: ocr.doc,
                ocr_name: ocr.doc.guestName ?? null,
                ocr_document: ocr.doc.docNumber ?? null,
                ocr_nationality: ocr.doc.nationality ?? null,
                ocr_language: ocr.doc.language ?? null,
                ocr_confidence: ocr.doc.confidence ?? null,
                ocr_attempts: (row.ocr_attempts ?? 0) + 1,
              };
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const { data: updated } = await (supabaseAdmin.from("checkin_records") as any)
                .update(ocrUpdates)
                .eq("id", row.id)
                .select("*")
                .single();
              if (updated) currentRow = updated as CheckinRow;
            }
          }
        } catch (err) {
          console.warn("[checkin/step2:getState] retro-OCR failed:", err);
        }
      }
      return NextResponse.json({ ok: true, state: getState(currentRow) });
    }

    // ── submit (foto opcional + datos manuales) ─────────────────────────────
    if (action === "submit") {
      const photo = body.idPhotoBase64 ? String(body.idPhotoBase64) : null;
      const email = body.email ? String(body.email).trim().toLowerCase() : null;
      const whatsapp = body.whatsapp ? String(body.whatsapp).trim() : null;
      const guestCount = body.guestCount != null ? Number(body.guestCount) : null;
      const consentAccepted = Boolean(body.consentAccepted);
      const typedName = body.typedName != null ? String(body.typedName).trim() : null;
      const typedDocument = body.typedDocument != null ? String(body.typedDocument).trim() : null;
      const typedNationality = body.typedNationality != null ? String(body.typedNationality).trim() : null;

      const updates: Record<string, unknown> = {};
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? null;
      const ua = req.headers.get("user-agent") ?? null;

      // 1) Foto + OCR (solo si viene nueva foto)
      if (photo) {
        if (photo.length > 11_000_000) return bad(413, "Imagen demasiado grande");
        const [header, b64] = photo.includes(",") ? [photo.split(",")[0], photo.split(",")[1]] : ["", photo];
        const mime = header.match(/data:([^;]+);/)?.[1] ?? "image/jpeg";
        const ext = mime.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
        const buffer = Buffer.from(b64, "base64");
        const path = `${row.tenant_id}/${row.id}.${ext}`;

        const { error: uploadErr } = await supabaseAdmin.storage
          .from("checkin-ids")
          .upload(path, buffer, { contentType: mime, upsert: true });
        if (uploadErr) {
          console.error("[checkin/step2] storage upload failed:", uploadErr);
          return bad(500, "No se pudo subir la imagen");
        }
        updates.id_photo_path = path;
        updates.id_status = "uploaded";

        // OCR en la misma request — el huesped espera el resultado para
        // que los campos se autocompleten.
        const ocr = await scanDocumentWithGemini(b64, mime);
        const attempts = (row.ocr_attempts ?? 0) + 1;
        updates.ocr_attempts = attempts;
        if (ocr.ok && ocr.doc) {
          updates.ocr_raw = ocr.doc;
          updates.ocr_name = ocr.doc.guestName ?? null;
          updates.ocr_document = ocr.doc.docNumber ?? null;
          updates.ocr_nationality = ocr.doc.nationality ?? null;
          updates.ocr_language = ocr.doc.language ?? null;
          updates.ocr_confidence = ocr.doc.confidence ?? null;
          // Si OCR fue suficientemente bueno, prellenamos guest_name
          // si no lo teniamos. Useful para reservas iCal con "Reserva Confirmada".
          if (ocr.doc.guestName && (!row.guest_name || row.guest_name === "Reserva Confirmada" || row.guest_name === "Huésped")) {
            updates.guest_name = ocr.doc.guestName;
          }
        }
      }

      // 2) Datos de contacto manuales
      if (email) updates.guest_email = email;
      if (whatsapp) updates.guest_whatsapp = whatsapp;
      if (guestCount != null && !Number.isNaN(guestCount)) updates.guest_count = Math.max(1, Math.round(guestCount));

      // 2b) Datos tipeados por el huesped (nombre/nacionalidad/documento).
      // Guardamos siempre lo que mando — aunque coincida con el OCR — para
      // tener el audit trail de "lo que el huesped confirmo" vs "lo que leyo
      // la maquina". La UI prellena estos campos con OCR, pero el huesped
      // los puede editar.
      if (typedName) updates.guest_typed_name = typedName;
      if (typedDocument) updates.guest_typed_document = typedDocument;
      if (typedNationality) updates.guest_typed_nationality = typedNationality;

      // 3) Consentimiento + audit
      if (consentAccepted && !row.consent_accepted_at) {
        updates.consent_accepted_at = new Date().toISOString();
      }
      if (ip) updates.ip_address = ip;
      if (ua) updates.user_agent = ua;

      if (Object.keys(updates).length === 0) {
        return NextResponse.json({ ok: true, state: getState(row) });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: updated, error: updateErr } = await (supabaseAdmin.from("checkin_records") as any)
        .update(updates)
        .eq("id", row.id)
        .select("*")
        .single();

      if (updateErr) {
        console.error("[checkin/step2] update failed:", updateErr);
        return bad(500, "No se pudo guardar");
      }

      return NextResponse.json({ ok: true, state: getState(updated as CheckinRow) });
    }

    // ── requestAuth (fallback cuando OCR no pudo leer) ──────────────────────
    if (action === "requestAuth") {
      const reason = String(body.reason ?? "ocr_failed");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabaseAdmin.from("checkin_records") as any)
        .update({
          waiting_for_auth: true,
          auth_reason: reason,
          requires_manual_review: true,
        })
        .eq("id", row.id);
      if (error) {
        console.error("[checkin/step2] requestAuth failed:", error);
        return bad(500, "No se pudo pedir autorizacion");
      }
      // TODO cuando se implemente: disparar email al host con link al panel.
      return NextResponse.json({ ok: true });
    }

    // ── complete (el huesped llego al Guest Hub con acceso liberado) ───────
    // Se llama una vez cuando el front renderiza el Paso 5 sin waiting_for_auth.
    // Idempotente: si ya esta seteado, no lo pisa.
    if (action === "complete") {
      if (row.checkin_completed_at) {
        return NextResponse.json({ ok: true, state: getState(row) });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: updated, error } = await (supabaseAdmin.from("checkin_records") as any)
        .update({ checkin_completed_at: new Date().toISOString() })
        .eq("id", row.id)
        .select("*")
        .single();
      if (error) {
        console.error("[checkin/step2:complete] update failed:", error);
        return bad(500, "No se pudo marcar como terminado");
      }
      return NextResponse.json({ ok: true, state: getState(updated as CheckinRow) });
    }

    return bad(400, "Accion no reconocida");
  } catch (err) {
    console.error("[checkin/step2] unexpected:", err);
    return bad(500, String(err));
  }
}
