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

interface ItemInput {
  upsellId?: string;
  quantity?: number | string;
  serviceDate?: string | null;
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
  cutoff_hours: number;
  active: boolean;
  vendor_id: string | null;
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

  const { data: upsellRows, error: upErr } = await supabaseAdmin
    .from("upsells")
    .select("id, name, price, currency, pricing_model, min_quantity, max_quantity, cutoff_hours, active, vendor_id")
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
      // Comparar timestamp: serviceDate como inicio del día UTC. Si el
      // huésped intenta una fecha más cerca que el cutoff, rechazar.
      const serviceTs = new Date(serviceDate + "T00:00:00Z").getTime();
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

  // Insertar order + items. Como no hay transacción multi-statement en el
  // client de Supabase, hacemos best-effort: insert orden, si falla retorna
  // error; insert items, si falla borramos la orden (cleanup manual).
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
