/**
 * POST /api/public/hub/[hostId]/service-order
 *
 * Endpoint PÚBLICO (sin auth) — el huésped lo invoca desde el Hub al
 * confirmar el carrito. Crea una `service_orders` + sus items con datos
 * SNAPSHOT del catálogo en el momento de la compra.
 *
 * Seguridad — el cliente NO controla nada que afecte plata:
 *   - El precio unitario lo lee el server desde `upsells` por id.
 *   - El nombre del producto también es snapshot server-side.
 *   - `total_amount` se calcula acá, no se acepta del body.
 *   - Valida cantidad contra min_quantity / max_quantity del upsell.
 *   - Valida que serviceDate respete cutoff_hours.
 *   - Filtra que cada upsell_id pertenezca al tenant (cross-tenant blindado).
 *
 * Idempotencia: cada llamada crea una orden nueva (un click malicioso = 2
 * órdenes). El huésped puede cancelarla si no la paga.
 *
 * Body: {
 *   guestName: string,
 *   guestEmail?: string,
 *   guestPhone?: string,
 *   notes?: string,
 *   items: Array<{ upsellId: string, quantity: number, serviceDate?: string }>
 * }
 * Response: { ok: true, orderId, customerToken, totalAmount, currency }
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { DEFAULT_TENANT_TZ } from "@/lib/datetime/tenant-time";
import { generateRedemptionPin, generateRedemptionToken } from "@/lib/upsell/redemption";

/**
 * Convierte una fecha YYYY-MM-DD en el timestamp del inicio del día en
 * el timezone dado. Sin esto un host en Santo Domingo (UTC-4) con cutoff
 * de 24h para servicio del 16/05 rechazaría órdenes legítimas porque
 * compara contra UTC midnight (que es 20:00 del 15/05 en hora local).
 */
function tenantDateToStartOfDayTs(dateStr: string, tz: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utcMidnight = Date.UTC(y, m - 1, d);
  // Offset del tz para esa fecha (positivo si tz adelantado, negativo si
  // atrasado vs UTC). Para UTC-4: offset = -4h, así que start-of-day local
  // en UTC = utcMidnight + 4h.
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(utcMidnight));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asLocal = Date.UTC(
    get("year"), get("month") - 1, get("day"),
    get("hour"), get("minute"), get("second"),
  );
  const offsetMs = asLocal - utcMidnight;
  return utcMidnight - offsetMs;
}

interface ItemInput {
  upsellId?: string;
  quantity?: number | string;
  serviceDate?: string | null;
  // Sprint 5: info adicional del servicio capturada al checkout.
  serviceTime?: string | null;
  pickupLocation?: string | null;
  flightNumber?: string | null;
  extraNotes?: string | null;
}

interface OrderBody {
  guestName?: string;
  guestEmail?: string;
  guestPhone?: string;
  notes?: string;
  items?: ItemInput[];
}

type UpsellSnapshot = {
  id: string;
  name: string;
  price: string | number;
  currency: string;
  pricing_model: string;
  min_quantity: number;
  max_quantity: number | null;
  capacity_per_slot: number | null;
  cutoff_hours: number;
  active: boolean;
  vendor_id: string | null;
  // Sprint 5: visibility de info del servicio (3-estado por campo)
  time_field: string | null;
  pickup_field: string | null;
  flight_field: string | null;
  notes_placeholder: string | null;
};

const VALID_PRICING_MODELS = new Set([
  "fixed",
  "per_person",
  "per_unit",
  "per_kg",
  "per_night",
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ hostId: string }> },
) {
  const { hostId } = await params;
  if (!hostId || !/^[0-9a-f-]{36}$/i.test(hostId)) {
    return NextResponse.json({ error: "hostId inválido" }, { status: 400 });
  }

  let body: OrderBody;
  try {
    body = (await req.json()) as OrderBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Validación de datos del huésped (mínimo nombre).
  const guestName = String(body.guestName ?? "").trim();
  if (!guestName || guestName.length > 200) {
    return NextResponse.json({ error: "guestName requerido" }, { status: 400 });
  }
  // Email opcional pero si viene, validamos formato razonable y largo
  // para no guardar basura ni meter cosas absurdas en replyTo del email.
  let guestEmail: string | null = null;
  if (body.guestEmail) {
    const raw = String(body.guestEmail).trim();
    if (raw.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      return NextResponse.json({ error: "guestEmail inválido" }, { status: 400 });
    }
    guestEmail = raw;
  }
  const guestPhone = body.guestPhone ? String(body.guestPhone).trim() : null;
  const notes = body.notes ? String(body.notes).slice(0, 1000) : null;

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "items requeridos" }, { status: 400 });
  }
  if (body.items.length > 20) {
    return NextResponse.json({ error: "Máximo 20 items por orden" }, { status: 400 });
  }

  // Validar tenant existe + buscar upsells del carrito en una sola query.
  // Filtramos por tenant_id para bloquear cross-tenant — si un cliente
  // manda upsell_id de otro tenant, no aparece en la query y rechazamos.
  const upsellIds = body.items
    .map((it) => (typeof it.upsellId === "string" ? it.upsellId : null))
    .filter((v): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v));
  if (upsellIds.length === 0) {
    return NextResponse.json({ error: "Ningún upsellId válido" }, { status: 400 });
  }

  // Tenant timezone — necesario para que `cutoff_hours` se compare contra
  // el inicio del día en hora local del host, no UTC. Sprint Z manda.
  const { data: tenantRow } = await supabaseAdmin
    .from("tenants")
    .select("timezone")
    .eq("id", hostId)
    .maybeSingle();
  const tenantTz =
    (tenantRow as { timezone: string | null } | null)?.timezone || DEFAULT_TENANT_TZ;

  const { data: upsellRows, error: upErr } = await supabaseAdmin
    .from("upsells")
    .select("id, name, price, currency, pricing_model, min_quantity, max_quantity, capacity_per_slot, cutoff_hours, active, vendor_id, time_field, pickup_field, flight_field, notes_placeholder")
    .eq("tenant_id", hostId)
    .in("id", upsellIds);

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }
  const upsellMap = new Map<string, UpsellSnapshot>();
  for (const r of (upsellRows ?? []) as UpsellSnapshot[]) {
    upsellMap.set(r.id, r);
  }

  // Validar cada item del carrito contra los snapshots reales.
  const now = new Date();
  const validatedItems: Array<{
    upsellId: string;
    vendorId: string | null;
    name: string;
    pricingModel: string;
    unitPrice: number;
    quantity: number;
    serviceDate: string | null;
    lineTotal: number;
    currency: string;
    // Sprint 5 — info del servicio capturada por el huésped
    serviceTime: string | null;
    pickupLocation: string | null;
    flightNumber: string | null;
    extraNotes: string | null;
  }> = [];

  for (const item of body.items) {
    const upsellId = typeof item.upsellId === "string" ? item.upsellId : "";
    const snap = upsellMap.get(upsellId);
    if (!snap) {
      return NextResponse.json(
        { error: `Producto ${upsellId} no encontrado o de otro tenant` },
        { status: 422 },
      );
    }
    if (!snap.active) {
      return NextResponse.json(
        { error: `${snap.name} ya no está disponible` },
        { status: 422 },
      );
    }
    if (!VALID_PRICING_MODELS.has(snap.pricing_model)) {
      return NextResponse.json(
        { error: `${snap.name} tiene configuración inválida (pricing_model)` },
        { status: 500 },
      );
    }

    const requestedQty = Number(item.quantity ?? 1);
    if (!Number.isInteger(requestedQty) || requestedQty <= 0) {
      return NextResponse.json(
        { error: `Cantidad inválida para ${snap.name}` },
        { status: 400 },
      );
    }
    // Productos `fixed` siempre quantity=1 lógicamente (el "Por orden"
    // del Hub usa unitPrice plano). Pero permitimos qty>1 si el usuario
    // pidió "el paquete fijo × 2" (ej: 2 decoraciones cumpleaños).
    const minQ = snap.min_quantity;
    const maxQ = snap.max_quantity;
    if (snap.pricing_model !== "fixed") {
      if (requestedQty < minQ) {
        return NextResponse.json(
          { error: `${snap.name}: mínimo ${minQ}` },
          { status: 422 },
        );
      }
      if (maxQ != null && requestedQty > maxQ) {
        return NextResponse.json(
          { error: `${snap.name}: máximo ${maxQ}` },
          { status: 422 },
        );
      }
    }

    // Validar fecha (si el upsell tiene cutoff, fecha es requerida y
    // debe estar al menos `cutoff_hours` en el futuro).
    let serviceDate: string | null = null;
    if (typeof item.serviceDate === "string" && item.serviceDate) {
      // Formato YYYY-MM-DD esperado.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.serviceDate)) {
        return NextResponse.json(
          { error: `Fecha inválida para ${snap.name}` },
          { status: 400 },
        );
      }
      serviceDate = item.serviceDate;
    }
    if (snap.cutoff_hours > 0) {
      if (!serviceDate) {
        return NextResponse.json(
          { error: `${snap.name} requiere fecha de servicio` },
          { status: 422 },
        );
      }
      // Comparar contra inicio del día EN HORA LOCAL del tenant. Antes
      // usábamos UTC midnight, lo que rechazaba fechas legítimas cuando
      // el tenant estaba en UTC- (Punta Cana es UTC-4).
      const serviceTs = tenantDateToStartOfDayTs(serviceDate, tenantTz);
      const cutoffTs = now.getTime() + snap.cutoff_hours * 3600 * 1000;
      if (serviceTs < cutoffTs) {
        return NextResponse.json(
          {
            error: `${snap.name}: se cierra ${snap.cutoff_hours}h antes del servicio. Elegí otra fecha.`,
          },
          { status: 422 },
        );
      }
    }

    // Sprint 5 — validar info del servicio según el estado de cada campo:
    //   'off'      → ignoramos (campo no se mostró al huésped)
    //   'optional' → aceptamos si viene, sin bloquear si vacío
    //   'required' → exigimos no-vacío, retornamos 422 si falta
    const timeFieldState = snap.time_field ?? "off";
    const pickupFieldState = snap.pickup_field ?? "off";
    const flightFieldState = snap.flight_field ?? "off";

    let serviceTime: string | null = null;
    if (timeFieldState !== "off") {
      const raw = typeof item.serviceTime === "string" ? item.serviceTime.trim() : "";
      if (!raw && timeFieldState === "required") {
        return NextResponse.json(
          { error: `${snap.name}: indicá la hora del servicio` },
          { status: 422 },
        );
      }
      if (raw.length > 50) {
        return NextResponse.json(
          { error: `${snap.name}: hora demasiado larga` },
          { status: 400 },
        );
      }
      serviceTime = raw || null;
    }

    let pickupLocation: string | null = null;
    if (pickupFieldState !== "off") {
      const raw = typeof item.pickupLocation === "string" ? item.pickupLocation.trim() : "";
      if (!raw && pickupFieldState === "required") {
        return NextResponse.json(
          { error: `${snap.name}: indicá el punto de recogida` },
          { status: 422 },
        );
      }
      if (raw.length > 500) {
        return NextResponse.json(
          { error: `${snap.name}: punto de recogida demasiado largo` },
          { status: 400 },
        );
      }
      pickupLocation = raw || null;
    }

    let flightNumber: string | null = null;
    if (flightFieldState !== "off") {
      const raw = typeof item.flightNumber === "string" ? item.flightNumber.trim().toUpperCase() : "";
      if (!raw) {
        if (flightFieldState === "required") {
          return NextResponse.json(
            { error: `${snap.name}: indicá tu número de vuelo` },
            { status: 422 },
          );
        }
        // optional + vacío → OK, dejamos null
      } else {
        // Si vino, validamos formato razonable. Tolerante a espacios/guiones.
        const normalized = raw.replace(/[\s-]/g, "");
        if (!/^[A-Z0-9]{3,10}$/.test(normalized)) {
          return NextResponse.json(
            { error: `${snap.name}: número de vuelo inválido (ej AA1234)` },
            { status: 400 },
          );
        }
        flightNumber = normalized;
      }
    }

    // Notas extras: aceptamos solo si el host las pidió (notes_placeholder
    // no null). Si vienen sin que el host lo configure, las ignoramos.
    let extraNotes: string | null = null;
    if (snap.notes_placeholder && typeof item.extraNotes === "string") {
      const raw = item.extraNotes.trim();
      if (raw.length > 0) {
        if (raw.length > 1000) {
          return NextResponse.json(
            { error: `${snap.name}: notas demasiado largas (máx 1000)` },
            { status: 400 },
          );
        }
        extraNotes = raw;
      }
    }

    const unitPrice = Number(snap.price);
    const lineTotal = snap.pricing_model === "fixed"
      ? unitPrice * requestedQty
      : unitPrice * requestedQty;
    validatedItems.push({
      upsellId: snap.id,
      vendorId: snap.vendor_id,
      name: snap.name,
      pricingModel: snap.pricing_model,
      unitPrice,
      quantity: requestedQty,
      serviceDate,
      lineTotal,
      currency: snap.currency || "USD",
      serviceTime,
      pickupLocation,
      flightNumber,
      extraNotes,
    });
  }

  // Validar que todos los items compartan moneda. Sprint B.1 no maneja
  // mezclas — el host de Punta Cana opera todo en USD por convención.
  const currencies = new Set(validatedItems.map((i) => i.currency));
  if (currencies.size > 1) {
    return NextResponse.json(
      { error: "El carrito mezcla monedas distintas — no soportado todavía" },
      { status: 422 },
    );
  }
  const orderCurrency = validatedItems[0].currency;
  const totalAmount = validatedItems.reduce((s, i) => s + i.lineTotal, 0);

  // ── Anti-overbook (Fase B.2) ────────────────────────────────────────────
  // Para cada item con capacity_per_slot y serviceDate, consultamos cuántas
  // unidades YA están reservadas para ese (upsell, fecha) sumando items de
  // órdenes en estado pending/paid/completed. Si sumando el pedido actual
  // supera la capacidad, rechazamos.
  //
  // pending también consume capacidad: el huésped está pagando ahora, no
  // queremos que otro huésped concurrente lo overbookee mientras tipea su
  // tarjeta. Si la orden expira sin pagar, el host puede cancelarla manual.
  const capacityChecks = validatedItems.filter((i) => {
    const snap = upsellMap.get(i.upsellId);
    return snap?.capacity_per_slot != null && i.serviceDate != null;
  });
  for (const item of capacityChecks) {
    const snap = upsellMap.get(item.upsellId)!;
    const cap = snap.capacity_per_slot as number;
    // Items ya reservados en la misma fecha (todos los tenants y órdenes).
    // RLS no aplica (supabaseAdmin) — filtramos manualmente por tenant.
    const { data: rows } = await supabaseAdmin
      .from("service_order_items")
      .select("quantity, service_orders!inner(tenant_id, status)")
      .eq("upsell_id", item.upsellId)
      .eq("service_date", item.serviceDate);
    type RowJoin = {
      quantity: number;
      service_orders: { tenant_id: string; status: string } | { tenant_id: string; status: string }[];
    };
    const ACTIVE_STATUS = new Set(["pending", "paid", "completed"]);
    let alreadyReserved = 0;
    for (const r of ((rows ?? []) as RowJoin[])) {
      // Supabase a veces devuelve el join como array, a veces como objeto.
      const so = Array.isArray(r.service_orders) ? r.service_orders[0] : r.service_orders;
      if (!so) continue;
      if (so.tenant_id !== hostId) continue;
      if (!ACTIVE_STATUS.has(so.status)) continue;
      alreadyReserved += r.quantity;
    }
    if (alreadyReserved + item.quantity > cap) {
      const available = Math.max(0, cap - alreadyReserved);
      return NextResponse.json(
        {
          error: `${snap.name}: capacidad agotada para esa fecha. ${available > 0 ? `Quedan ${available}.` : "Sin disponibilidad."}`,
        },
        { status: 409 },
      );
    }
  }

  // Insertar order + items. Como no hay transacción multi-statement en el
  // client de Supabase, hacemos best-effort: insert orden, si falla retorna
  // error; insert items, si falla borramos la orden (cleanup manual).
  // Redemption credentials (Sprint 6) — token largo para el QR + PIN corto
  // para el fallback dictable. Se generan acá en el server al crear la orden
  // y se guardan en BD. El vendor los validará desde su portal al entregar.
  //
  // Colisión del PIN: ~191M combinaciones; probabilidad de colisión cross-
  // tenant baja pero no nula. Para v1 no chequeamos colisión activa — si
  // hay duplicado, el vendor del host A puede confundirse con orden de B.
  // Mitigamos requiriendo que el vendor venga autenticado (con su propio
  // token) en la validación, así el match se hace por (PIN, vendor_id).
  const redemptionToken = generateRedemptionToken();
  const redemptionPin = generateRedemptionPin();

  const { data: orderInsert, error: orderErr } = await supabaseAdmin
    .from("service_orders")
    .insert({
      tenant_id: hostId,
      guest_name: guestName,
      guest_email: guestEmail,
      guest_phone: guestPhone,
      status: "pending",
      total_amount: totalAmount,
      currency: orderCurrency,
      notes,
      redemption_token: redemptionToken,
      redemption_pin: redemptionPin,
    } as never)
    .select("id, customer_token")
    .single();

  if (orderErr || !orderInsert) {
    return NextResponse.json(
      { error: orderErr?.message || "Error creando orden" },
      { status: 500 },
    );
  }
  const order = orderInsert as { id: string; customer_token: string };

  const itemsToInsert = validatedItems.map((i) => ({
    order_id: order.id,
    upsell_id: i.upsellId,
    vendor_id: i.vendorId,
    name: i.name,
    pricing_model: i.pricingModel,
    unit_price: i.unitPrice,
    quantity: i.quantity,
    service_date: i.serviceDate,
    line_total: i.lineTotal,
    // Sprint 5
    service_time: i.serviceTime,
    pickup_location: i.pickupLocation,
    flight_number: i.flightNumber,
    extra_notes: i.extraNotes,
  }));
  const { error: itemsErr } = await supabaseAdmin
    .from("service_order_items")
    .insert(itemsToInsert as never);

  if (itemsErr) {
    // Cleanup: borrar la orden huérfana para no contaminar BD.
    await supabaseAdmin.from("service_orders").delete().eq("id", order.id);
    return NextResponse.json(
      { error: `No se pudieron crear los items: ${itemsErr.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    orderId: order.id,
    customerToken: order.customer_token,
    totalAmount,
    currency: orderCurrency,
  });
}
