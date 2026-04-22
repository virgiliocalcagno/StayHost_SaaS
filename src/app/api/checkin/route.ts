/**
 * Check-in API — /api/checkin
 *
 * Persists guest check-in state in Supabase (`public.checkin_records`) and
 * stores ID photos in a private Storage bucket (`checkin-ids`). Replaces the
 * in-memory `Map` that evaporated between serverless invocations.
 *
 * Two kinds of callers hit this endpoint:
 *
 *   A. STAFF (authenticated host/owner, has a Supabase session):
 *      actions: create, list, update, delete, validateId, rejectId, get
 *      Scope: only their own tenant's records (enforced via
 *      `getAuthenticatedTenant()` + tenant_id filter).
 *
 *   B. GUEST (unauthenticated, opens the check-in link on their phone):
 *      actions: auth, get, uploadId, payElectricity
 *      Scope: a single record, identified by record id + soft token
 *      (lastName + last4 of phone). The middleware already lets this path
 *      through without a session.
 *
 * The branch is decided per action — staff-only actions refuse unauthenticated
 * callers; guest actions always require the soft token so a record id leak
 * alone can't reveal a guest's ID photo.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// ─── Types ───────────────────────────────────────────────────────────────────

type IdStatus = "pending" | "uploaded" | "validated" | "rejected";
type Status = "pendiente" | "validado";

type Source = "manual" | "auto_direct" | "auto_ical";

interface CheckinRow {
  id: string;
  tenant_id: string;
  guest_name: string;
  guest_last_name: string;
  last_four_digits: string;
  checkin: string;
  checkout: string;
  nights: number;
  property_id: string | null;
  property_name: string;
  property_address: string | null;
  property_image: string | null;
  wifi_ssid: string | null;
  wifi_password: string | null;
  electricity_enabled: boolean;
  electricity_rate: number;
  electricity_paid: boolean;
  electricity_total: number;
  paypal_fee_included: boolean;
  id_photo_path: string | null;
  id_status: IdStatus;
  access_granted: boolean;
  status: Status;
  booking_ref: string | null;
  source: Source;
  channel: string | null;
  missing_data: boolean;
  created_at: string;
  updated_at: string;
  // v3 — Paso 2 adaptativo + Sala de Espera
  guest_email?: string | null;
  guest_whatsapp?: string | null;
  guest_count?: number | null;
  ocr_name?: string | null;
  ocr_document?: string | null;
  ocr_nationality?: string | null;
  ocr_confidence?: number | null;
  waiting_for_auth?: boolean | null;
  auth_reason?: string | null;
  requires_manual_review?: boolean | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcElectricity(nights: number, rate: number, includePaypal: boolean) {
  const subtotal = nights * rate;
  return includePaypal ? Number((subtotal / 0.943).toFixed(2)) : subtotal;
}

function newId() {
  return `ci-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Project a DB row into the legacy API shape so the existing frontend keeps
 * working without changes. `wifiPassword` is only exposed once access is
 * granted; `idPhotoBase64` is never returned — the client should request a
 * signed URL if it needs to display the photo (out of scope for now).
 */
function rowToApi(row: CheckinRow, opts: { exposeWifi: boolean }) {
  return {
    id: row.id,
    guestName: row.guest_name,
    guestLastName: row.guest_last_name,
    lastFourDigits: row.last_four_digits,
    checkin: row.checkin,
    checkout: row.checkout,
    nights: row.nights,
    propertyId: row.property_id ?? "",
    propertyName: row.property_name,
    propertyAddress: row.property_address ?? undefined,
    propertyImage: row.property_image ?? undefined,
    wifiSsid: row.wifi_ssid ?? undefined,
    wifiPassword: opts.exposeWifi ? (row.wifi_password ?? undefined) : undefined,
    electricityEnabled: row.electricity_enabled,
    electricityRate: row.electricity_rate,
    electricityPaid: row.electricity_paid,
    electricityTotal: row.electricity_total,
    paypalFeeIncluded: row.paypal_fee_included,
    idStatus: row.id_status,
    accessGranted: row.access_granted,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    bookingRef: row.booking_ref ?? undefined,
    source: row.source,
    channel: row.channel ?? undefined,
    missingData: row.missing_data,
    // idPhotoBase64 intentionally omitted — use a signed Storage URL.
    idPhotoPath: row.id_photo_path ?? undefined,
    // v3 — para el dashboard de autorizaciones pendientes
    waitingForAuth: row.waiting_for_auth ?? false,
    authReason: row.auth_reason ?? null,
    guestEmail: row.guest_email ?? null,
    guestWhatsapp: row.guest_whatsapp ?? null,
    guestCount: row.guest_count ?? null,
    ocrName: row.ocr_name ?? null,
    ocrDocument: row.ocr_document ?? null,
    ocrNationality: row.ocr_nationality ?? null,
  };
}

async function fetchRecordForGuest(
  id: string,
  lastName: string,
  last4: string
): Promise<CheckinRow | null> {
  const { data } = await supabaseAdmin
    .from("checkin_records")
    .select("*")
    .eq("id", id)
    .maybeSingle<CheckinRow>();
  if (!data) return null;

  // El soft-token primario es el código de reserva (channel_code o apellido).
  // Los últimos 4 del teléfono se validan SOLO si vienen — algunas reservas
  // de VRBO o directas no tienen teléfono, y el lookup ya no los pide al
  // huésped. El channel_code Airbnb/SH es suficientemente único por sí solo.
  const last4Trimmed = last4.trim();
  if (last4Trimmed && data.last_four_digits && data.last_four_digits !== last4Trimmed) {
    return null;
  }

  const credLC = lastName.toLowerCase().trim();

  // Opción A: el parámetro enviado es el apellido real y matchea
  // (flujo legacy de links con apellido conocido).
  if (data.guest_last_name === credLC) return data;

  // Opción B: el parámetro es el código de reserva del canal (Airbnb
  // HMXXXXXXXX, reservas directas SHXXXXXXXX). Validamos contra el
  // channel_code del booking vinculado. Esto es lo que usa el flow v=2
  // donde el huésped nunca escribió un apellido.
  if (data.booking_ref) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- no generated DB types yet
    const { data: booking } = await (supabaseAdmin.from("bookings") as any)
      .select("channel_code")
      .eq("id", data.booking_ref)
      .maybeSingle();
    const bookingCode = String((booking as { channel_code?: string | null } | null)?.channel_code ?? "").toLowerCase().trim();
    if (bookingCode && bookingCode === credLC) return data;
  }

  return null;
}

function bad(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const data = body as Record<string, unknown>;

    switch (action) {
      // ── Staff-only actions ────────────────────────────────────────────────
      case "create":       return staffCreate(data);
      case "list":         return staffList();
      case "update":       return staffUpdate(data);
      case "delete":       return staffDelete(data);
      case "validateId":   return staffSetIdStatus(data, "validated");
      case "rejectId":     return staffSetIdStatus(data, "rejected");
      case "upsertBatch":  return staffUpsertBatch(data);
      case "authorize":    return staffAuthorize(data);

      // ── Guest actions (no session, soft token required) ───────────────────
      case "auth":              return guestAuth(data);
      case "get":               return guestGet(data);
      case "uploadId":          return guestUploadId(data);
      case "payElectricity":    return guestPayElectricity(data);

      default:
        return bad(400, "Acción no reconocida");
    }
  } catch (err) {
    console.error("[/api/checkin] unexpected error:", err);
    return bad(500, String(err));
  }
}

// ─── Staff actions ───────────────────────────────────────────────────────────

async function staffCreate(data: Record<string, unknown>) {
  const { tenantId } = await getAuthenticatedTenant();
  if (!tenantId) return bad(401, "No autenticado");

  const nights = (data.nights as number) ?? 1;
  const rate = (data.electricityRate as number) ?? 5;
  const paypal = (data.paypalFeeIncluded as boolean) ?? true;

  // Narrow `source` to the enum the DB constraint accepts.
  const rawSource = String(data.source ?? "manual");
  const source: Source =
    rawSource === "auto_direct" || rawSource === "auto_ical"
      ? (rawSource as Source)
      : "manual";

  const row = {
    id: data.id ? String(data.id) : newId(),
    tenant_id: tenantId,
    guest_name: String(data.guestName ?? ""),
    guest_last_name: String(data.guestLastName ?? "").toLowerCase().trim(),
    last_four_digits: String(data.lastFourDigits ?? "").trim(),
    checkin: String(data.checkin ?? ""),
    checkout: String(data.checkout ?? ""),
    nights,
    property_id: data.propertyId ? String(data.propertyId) : null,
    property_name: String(data.propertyName ?? ""),
    property_address: data.propertyAddress ? String(data.propertyAddress) : null,
    property_image: data.propertyImage ? String(data.propertyImage) : null,
    wifi_ssid: data.wifiSsid ? String(data.wifiSsid) : null,
    wifi_password: data.wifiPassword ? String(data.wifiPassword) : null,
    electricity_enabled: (data.electricityEnabled as boolean) ?? true,
    electricity_rate: rate,
    electricity_paid: false,
    electricity_total: calcElectricity(nights, rate, paypal),
    paypal_fee_included: paypal,
    id_status: "pending" as const,
    access_granted: false,
    status: "pendiente" as const,
    booking_ref: data.bookingRef ? String(data.bookingRef) : null,
    source,
    channel: data.channel ? String(data.channel) : null,
    missing_data: (data.missingData as boolean) ?? false,
  };

  // Uses the user's session client so RLS enforces tenant_id = current_tenant_id().
  const { supabase } = await getAuthenticatedTenant();
  const { data: inserted, error } = await supabase
    .from("checkin_records")
    .insert(row)
    .select("*")
    .single<CheckinRow>();

  if (error || !inserted) {
    console.error("[/api/checkin:create] insert failed:", error);
    return bad(500, "No se pudo crear el check-in");
  }

  return NextResponse.json({
    success: true,
    id: inserted.id,
    record: rowToApi(inserted, { exposeWifi: false }),
  });
}

async function staffList() {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) return bad(401, "No autenticado");

  const { data, error } = await supabase
    .from("checkin_records")
    .select("*")
    .order("checkin", { ascending: true });

  if (error) {
    console.error("[/api/checkin:list] query failed:", error);
    return bad(500, "No se pudo listar check-ins");
  }

  const records = ((data ?? []) as CheckinRow[]).map((r) =>
    rowToApi(r, { exposeWifi: false })
  );
  return NextResponse.json({ records });
}

async function staffUpdate(data: Record<string, unknown>) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) return bad(401, "No autenticado");
  const id = String(data.id ?? "");
  if (!id) return bad(400, "Falta id");

  // Whitelist the fields staff can update. Camel → snake mapping is explicit
  // to avoid accidentally letting callers overwrite tenant_id, id_status, etc.
  const patch: Record<string, unknown> = {};
  const setIfPresent = (camel: string, snake: string) => {
    if (camel in data) patch[snake] = data[camel];
  };
  setIfPresent("guestName", "guest_name");
  if ("guestLastName" in data) {
    patch.guest_last_name = String(data.guestLastName ?? "").toLowerCase().trim();
  }
  if ("lastFourDigits" in data) {
    patch.last_four_digits = String(data.lastFourDigits ?? "").trim();
  }
  setIfPresent("checkin", "checkin");
  setIfPresent("checkout", "checkout");
  setIfPresent("nights", "nights");
  setIfPresent("propertyId", "property_id");
  setIfPresent("propertyName", "property_name");
  setIfPresent("propertyAddress", "property_address");
  setIfPresent("propertyImage", "property_image");
  setIfPresent("wifiSsid", "wifi_ssid");
  setIfPresent("wifiPassword", "wifi_password");
  setIfPresent("electricityEnabled", "electricity_enabled");
  setIfPresent("electricityRate", "electricity_rate");
  setIfPresent("paypalFeeIncluded", "paypal_fee_included");
  setIfPresent("bookingRef", "booking_ref");
  setIfPresent("missingData", "missing_data");
  setIfPresent("channel", "channel");
  setIfPresent("electricityPaid", "electricity_paid");

  // Recalculate electricity_total if any of the inputs changed.
  if (
    "nights" in data ||
    "electricityRate" in data ||
    "paypalFeeIncluded" in data
  ) {
    const { data: current } = await supabase
      .from("checkin_records")
      .select("nights, electricity_rate, paypal_fee_included")
      .eq("id", id)
      .single<Pick<CheckinRow, "nights" | "electricity_rate" | "paypal_fee_included">>();
    if (current) {
      const nights = (patch.nights as number) ?? current.nights;
      const rate = (patch.electricity_rate as number) ?? current.electricity_rate;
      const paypal =
        (patch.paypal_fee_included as boolean) ?? current.paypal_fee_included;
      patch.electricity_total = calcElectricity(nights, rate, paypal);
    }
  }

  const { data: updated, error } = await supabase
    .from("checkin_records")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single<CheckinRow>();

  if (error || !updated) {
    console.error("[/api/checkin:update] failed:", error);
    return bad(404, "No se encontró el check-in");
  }
  return NextResponse.json({
    success: true,
    record: rowToApi(updated, { exposeWifi: false }),
  });
}

async function staffDelete(data: Record<string, unknown>) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) return bad(401, "No autenticado");
  const id = String(data.id ?? "");
  if (!id) return bad(400, "Falta id");

  // Delete the ID photo from Storage first (if any). Best-effort — if Storage
  // fails we still delete the row so the staff isn't stuck with a ghost record.
  const { data: row } = await supabase
    .from("checkin_records")
    .select("id_photo_path")
    .eq("id", id)
    .maybeSingle<Pick<CheckinRow, "id_photo_path">>();
  if (row?.id_photo_path) {
    await supabaseAdmin.storage.from("checkin-ids").remove([row.id_photo_path]);
  }

  const { error } = await supabase.from("checkin_records").delete().eq("id", id);
  if (error) {
    console.error("[/api/checkin:delete] failed:", error);
    return bad(500, "No se pudo borrar");
  }
  return NextResponse.json({ success: true });
}

async function staffSetIdStatus(
  data: Record<string, unknown>,
  next: "validated" | "rejected"
) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) return bad(401, "No autenticado");
  const id = String(data.id ?? "");
  if (!id) return bad(400, "Falta id");

  const { data: current } = await supabase
    .from("checkin_records")
    .select("electricity_enabled, electricity_paid")
    .eq("id", id)
    .single<Pick<CheckinRow, "electricity_enabled" | "electricity_paid">>();
  if (!current) return bad(404, "No encontrado");

  const electricityOk = !current.electricity_enabled || current.electricity_paid;
  const accessGranted = next === "validated" && electricityOk;

  const patch = {
    id_status: next,
    access_granted: accessGranted,
    status: (accessGranted ? "validado" : "pendiente") as Status,
  };

  const { data: updated, error } = await supabase
    .from("checkin_records")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single<CheckinRow>();

  if (error || !updated) {
    console.error("[/api/checkin:setIdStatus] failed:", error);
    return bad(500, "No se pudo actualizar");
  }
  return NextResponse.json({
    success: true,
    record: rowToApi(updated, { exposeWifi: accessGranted }),
  });
}

async function staffAuthorize(data: Record<string, unknown>) {
  // El host aprueba manualmente un checkin que estaba en Sala de Espera
  // (OCR no legible o pago electrico por autorizacion). Libera el acceso:
  // waiting_for_auth=false, access_granted=true, y marca electricity_paid
  // si el motivo era electricidad.
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) return bad(401, "No autenticado");
  const id = String(data.id ?? "");
  if (!id) return bad(400, "Falta id");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: current } = await (supabase.from("checkin_records") as any)
    .select("auth_reason")
    .eq("id", id)
    .single();
  const reason = (current as { auth_reason?: string | null } | null)?.auth_reason ?? null;

  const patch: Record<string, unknown> = {
    waiting_for_auth: false,
    auth_reason: null,
    access_granted: true,
    status: "validado",
  };
  if (reason === "electricity_pending") {
    patch.electricity_paid = true;
  }
  if (reason === "ocr_failed") {
    patch.id_status = "validated";
    patch.requires_manual_review = true;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error } = await (supabase.from("checkin_records") as any)
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error || !updated) {
    console.error("[/api/checkin:authorize] failed:", error);
    return bad(500, "No se pudo autorizar");
  }
  return NextResponse.json({
    success: true,
    record: rowToApi(updated as CheckinRow, { exposeWifi: true }),
  });
}

async function staffUpsertBatch(data: Record<string, unknown>) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) return bad(401, "No autenticado");

  const rawRecords = Array.isArray(data.records) ? data.records : [];
  if (rawRecords.length === 0) {
    return NextResponse.json({ success: true, inserted: 0, records: [] });
  }

  // Map each camelCase input into the DB row shape + stamp tenant_id. We
  // never trust `tenant_id` from the client.
  type RawRecord = Record<string, unknown>;
  const rows = (rawRecords as RawRecord[]).map((r) => {
    const nights = (r.nights as number) ?? 1;
    const rate = (r.electricityRate as number) ?? 5;
    const paypal = (r.paypalFeeIncluded as boolean) ?? true;
    const rawSource = String(r.source ?? "manual");
    const source: Source =
      rawSource === "auto_direct" || rawSource === "auto_ical"
        ? (rawSource as Source)
        : "manual";
    return {
      id: r.id ? String(r.id) : newId(),
      tenant_id: tenantId,
      guest_name: String(r.guestName ?? ""),
      guest_last_name: String(r.guestLastName ?? "").toLowerCase().trim(),
      last_four_digits: String(r.lastFourDigits ?? "").trim(),
      checkin: String(r.checkin ?? ""),
      checkout: String(r.checkout ?? ""),
      nights,
      property_id: r.propertyId ? String(r.propertyId) : null,
      property_name: String(r.propertyName ?? ""),
      property_address: r.propertyAddress ? String(r.propertyAddress) : null,
      property_image: r.propertyImage ? String(r.propertyImage) : null,
      wifi_ssid: r.wifiSsid ? String(r.wifiSsid) : null,
      wifi_password: r.wifiPassword ? String(r.wifiPassword) : null,
      electricity_enabled: (r.electricityEnabled as boolean) ?? true,
      electricity_rate: rate,
      electricity_paid: (r.electricityPaid as boolean) ?? false,
      electricity_total: (r.electricityTotal as number) ?? calcElectricity(nights, rate, paypal),
      paypal_fee_included: paypal,
      id_status: ((r.idStatus as IdStatus) ?? "pending") as IdStatus,
      access_granted: (r.accessGranted as boolean) ?? false,
      status: (((r.status as Status) ?? "pendiente") as Status),
      booking_ref: r.bookingRef ? String(r.bookingRef) : null,
      source,
      channel: r.channel ? String(r.channel) : null,
      missing_data: (r.missingData as boolean) ?? false,
    };
  });

  // `onConflict: id` makes re-running autoSync idempotent — existing records
  // get a patch update instead of erroring on the primary key.
  const { data: inserted, error } = await supabase
    .from("checkin_records")
    .upsert(rows, { onConflict: "id" })
    .select("*");

  if (error) {
    console.error("[/api/checkin:upsertBatch] failed:", error);
    return bad(500, "No se pudo sincronizar el lote");
  }

  const records = ((inserted ?? []) as CheckinRow[]).map((r) =>
    rowToApi(r, { exposeWifi: false })
  );
  return NextResponse.json({ success: true, inserted: records.length, records });
}

// ─── Guest actions ───────────────────────────────────────────────────────────

async function guestAuth(data: Record<string, unknown>) {
  const id = String(data.id ?? "");
  const lastName = String(data.lastName ?? "");
  const last4 = String(data.last4 ?? "");
  if (!id) return bad(400, "Falta id");

  const row = await fetchRecordForGuest(id, lastName, last4);
  if (!row) {
    return bad(
      401,
      "Datos incorrectos. Verifica tu apellido y los últimos 4 dígitos de tu teléfono."
    );
  }
  return NextResponse.json({
    success: true,
    record: rowToApi(row, { exposeWifi: row.access_granted }),
  });
}

async function guestGet(data: Record<string, unknown>) {
  const id = String(data.id ?? "");
  const lastName = String(data.lastName ?? "");
  const last4 = String(data.last4 ?? "");

  // Allow `get` without soft token for the welcome step — but in that case we
  // never expose wifi credentials. The guest must pass `auth` to unlock them.
  if (!id) return bad(400, "Falta id");

  if (lastName) {
    const row = await fetchRecordForGuest(id, lastName, last4);
    if (!row) return bad(404, "No encontrado");
    return NextResponse.json({
      record: rowToApi(row, { exposeWifi: row.access_granted }),
    });
  }

  const { data: row } = await supabaseAdmin
    .from("checkin_records")
    .select("*")
    .eq("id", id)
    .maybeSingle<CheckinRow>();
  if (!row) return bad(404, "No encontrado");
  return NextResponse.json({ record: rowToApi(row, { exposeWifi: false }) });
}

async function guestUploadId(data: Record<string, unknown>) {
  const id = String(data.id ?? "");
  const lastName = String(data.lastName ?? "");
  const last4 = String(data.last4 ?? "");
  const photo = String(data.idPhotoBase64 ?? "");
  if (!id || !photo) return bad(400, "Faltan datos");
  if (photo.length > 11_000_000) return bad(413, "Imagen demasiado grande (máx 8MB)");

  // Guest must authenticate with their soft token BEFORE uploading — this
  // prevents randos from dumping files into Storage by brute-forcing ids.
  // El token primario es el código de reserva (lastName). last4 es opcional:
  // reservas sin teléfono (VRBO, algunas directas) no lo envían.
  const row = lastName
    ? await fetchRecordForGuest(id, lastName, last4)
    : null;
  if (!row) {
    console.warn("[/api/checkin:uploadId] auth failed", { id, lastName, hasLast4: Boolean(last4) });
    return bad(401, "No autorizado");
  }

  // Strip the data URL prefix if present (`data:image/jpeg;base64,...`).
  const [header, b64Payload] = photo.includes(",")
    ? [photo.split(",")[0], photo.split(",")[1]]
    : ["", photo];
  const mime =
    header.match(/data:([^;]+);/)?.[1] ?? "image/jpeg";
  const ext = mime.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const buffer = Buffer.from(b64Payload, "base64");

  const path = `${row.tenant_id}/${row.id}.${ext}`;
  const { error: uploadErr } = await supabaseAdmin.storage
    .from("checkin-ids")
    .upload(path, buffer, { contentType: mime, upsert: true });
  if (uploadErr) {
    console.error("[/api/checkin:uploadId] storage upload failed:", uploadErr);
    return bad(500, "No se pudo subir la imagen");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- no generated DB types yet
  const { error: updateErr } = await (supabaseAdmin.from("checkin_records") as any)
    .update({ id_photo_path: path, id_status: "uploaded" })
    .eq("id", row.id);
  if (updateErr) {
    console.error("[/api/checkin:uploadId] update failed:", updateErr);
    return bad(500, "No se pudo registrar la imagen");
  }

  return NextResponse.json({ success: true });
}

async function guestPayElectricity(data: Record<string, unknown>) {
  const id = String(data.id ?? "");
  const lastName = String(data.lastName ?? "");
  const last4 = String(data.last4 ?? "");
  if (!id) return bad(400, "Falta id");

  const row = lastName
    ? await fetchRecordForGuest(id, lastName, last4)
    : null;
  if (!row) return bad(401, "No autorizado");

  // If the ID is already validated, paying unlocks access. Otherwise we just
  // flag the payment and wait for staff to validate the ID.
  const willGrant = row.id_status === "validated";
  const patch = {
    electricity_paid: true,
    access_granted: willGrant,
    status: (willGrant ? "validado" : "pendiente") as Status,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- no generated DB types yet
  const { data: updated, error } = (await (supabaseAdmin.from("checkin_records") as any)
    .update(patch)
    .eq("id", row.id)
    .select("*")
    .single()) as { data: CheckinRow | null; error: unknown };

  if (error || !updated) {
    console.error("[/api/checkin:payElectricity] failed:", error);
    return bad(500, "No se pudo registrar el pago");
  }

  return NextResponse.json({
    success: true,
    accessGranted: updated.access_granted,
    record: rowToApi(updated, { exposeWifi: updated.access_granted }),
  });
}
