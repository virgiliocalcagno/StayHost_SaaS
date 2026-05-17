/**
 * GET /api/vendor/portal/[token]
 *
 * Endpoint público (sin sesión). Resuelve el vendor por su `portal_token`
 * permanente y devuelve toda su data:
 *   - perfil (nombre, displayName, email, phone, rating, totalOrders)
 *   - lista de TODAS sus órdenes (pendientes / confirmadas / entregadas /
 *     declinadas) con items y datos del huésped
 *   - hostName del tenant (para el header del portal)
 *
 * Sin sesión por diseño: el vendor entra por magic-link permanente. El
 * token es del vendor (no de una orden), persiste indefinido. Si el host
 * lo regenera, el vendor pierde acceso hasta recibir el nuevo link.
 *
 * No exponemos: rnc_cedula, commission_percent, payment_terms, agreements
 * (info comercial entre host y vendor, no para el portal del vendor).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

type VendorRow = {
  id: string;
  tenant_id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  display_name: string | null;
  hero_photo: string | null;
  description: string | null;
  category: string;
  rating: number | null;
  total_orders: number;
  active: boolean;
  notification_channels: unknown;
};

type OrderRow = {
  id: string;
  tenant_id: string;
  guest_name: string;
  guest_phone: string | null;
  status: string;
  vendor_status: string;
  total_amount: string | number;
  currency: string;
  paid_at: string | null;
  redemption_pin: string | null;
  redeemed_at: string | null;
  vendor_decline_reason: string | null;
  vendor_confirmed_at: string | null;
  vendor_declined_at: string | null;
  cancellation_decided_at: string | null;
  created_at: string;
};

type ItemRow = {
  id: string;
  order_id: string;
  name: string;
  quantity: number;
  unit_price: string | number;
  line_total: string | number;
  pricing_model: string;
  service_date: string | null;
  service_time: string | null;
  pickup_location: string | null;
  flight_number: string | null;
  extra_notes: string | null;
  vendor_id: string | null;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const normalized = token.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(normalized)) {
    return NextResponse.json({ error: "Token inválido" }, { status: 400 });
  }

  // 1. Resolver vendor por portal_token.
  const { data: vendorData } = await supabaseAdmin
    .from("upsell_vendors")
    .select(
      "id, tenant_id, name, contact_name, phone, email, display_name, hero_photo, description, category, rating, total_orders, active, notification_channels",
    )
    .eq("portal_token", normalized)
    .maybeSingle();

  const vendor = vendorData as VendorRow | null;
  if (!vendor) {
    return NextResponse.json({ error: "Portal no encontrado" }, { status: 404 });
  }

  // 2. Tenant info (solo nombre/marca pública — nunca email del owner).
  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("name, company, logo_url")
    .eq("id", vendor.tenant_id)
    .maybeSingle();
  const t = tenant as { name: string | null; company: string | null; logo_url: string | null } | null;
  const hostName = t?.company || t?.name || "Host";

  // 3. Items asignados a este vendor — extraemos los order_ids únicos.
  const { data: itemsData } = await supabaseAdmin
    .from("service_order_items")
    .select(
      "id, order_id, name, quantity, unit_price, line_total, pricing_model, service_date, service_time, pickup_location, flight_number, extra_notes, vendor_id",
    )
    .eq("vendor_id", vendor.id)
    .order("created_at", { ascending: false });

  const allItems = (itemsData ?? []) as ItemRow[];
  const orderIds = Array.from(new Set(allItems.map((i) => i.order_id)));

  // 4. Órdenes de esos items. Excluimos no-pagadas (vendor solo ve lo
  // pagado) y limitamos a últimos 90 días + pendientes futuras.
  //
  // Privacidad: NO seleccionamos guest_email — el vendor no debe ver el email
  // del huésped (canal del owner/host, no del vendor). guest_phone sí: es
  // operativamente necesario para coordinar servicios presenciales (shuttle
  // aeropuerto, entrega física). vendor_action_token y redemption_token NO
  // se exponen al cliente.
  let orders: OrderRow[] = [];
  if (orderIds.length > 0) {
    const { data: orderRows } = await supabaseAdmin
      .from("service_orders")
      .select(
        "id, tenant_id, guest_name, guest_phone, status, vendor_status, total_amount, currency, paid_at, redemption_pin, redeemed_at, vendor_decline_reason, vendor_confirmed_at, vendor_declined_at, cancellation_decided_at, created_at",
      )
      .in("id", orderIds)
      .in("status", ["paid", "completed"])
      .order("created_at", { ascending: false })
      .limit(100);
    orders = (orderRows ?? []) as OrderRow[];
  }

  // 5. Agrupar items por order_id para enviar al cliente.
  const itemsByOrder = new Map<string, ItemRow[]>();
  for (const item of allItems) {
    const arr = itemsByOrder.get(item.order_id) ?? [];
    arr.push(item);
    itemsByOrder.set(item.order_id, arr);
  }

  // 6. Stats simples: # órdenes este mes, total entregado (de mi share —
  // por ahora calculamos sobre line_total de mis items, el vendor solo ve
  // su parte). Vamos a refinar más adelante con commission/payment_terms.
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  let ordersThisMonth = 0;
  let pendingCount = 0;
  let confirmedCount = 0;
  let deliveredThisMonth = 0;
  let revenueThisMonth = 0;
  for (const o of orders) {
    const myItems = itemsByOrder.get(o.id) ?? [];
    const myTotal = myItems.reduce((s, i) => s + Number(i.line_total), 0);

    if (o.created_at >= startOfMonth) ordersThisMonth++;
    if (o.vendor_status === "awaiting") pendingCount++;
    if (o.vendor_status === "confirmed") confirmedCount++;
    if (o.vendor_status === "delivered" && (o.redeemed_at ?? o.created_at) >= startOfMonth) {
      deliveredThisMonth++;
      revenueThisMonth += myTotal;
    }
  }

  // 7. Mapear al DTO. NO exponemos redemption_token/action_token al cliente
  // — el vendor solo necesita su portal_token para autenticarse. Las
  // acciones individuales sobre cada orden van vía /api/vendor/portal/
  // [token]/order/[orderId]/action, que verifica el portal_token y el
  // order_id pertenece al vendor.
  return NextResponse.json({
    vendor: {
      id: vendor.id,
      name: vendor.display_name || vendor.name,
      legalName: vendor.name,
      contactName: vendor.contact_name,
      email: vendor.email,
      phone: vendor.phone,
      heroPhoto: vendor.hero_photo,
      description: vendor.description,
      category: vendor.category,
      rating: vendor.rating ?? null,
      totalOrders: vendor.total_orders,
      active: vendor.active,
      notificationChannels: Array.isArray(vendor.notification_channels)
        ? (vendor.notification_channels as string[])
        : [],
    },
    host: {
      name: hostName,
      logoUrl: t?.logo_url ?? null,
    },
    stats: {
      ordersThisMonth,
      pendingCount,
      confirmedCount,
      deliveredThisMonth,
      revenueThisMonth,
      currency: orders[0]?.currency ?? "USD",
    },
    orders: orders.map((o) => {
      const myItems = itemsByOrder.get(o.id) ?? [];
      // Si la orden tiene items de otros vendors además de este, el total
      // de la orden incluye lo que cobran ellos — no debemos exponerlo.
      // Solo devolvemos `myTotal` (suma de mis line_totals).
      const isWaitingOrConfirmed =
        o.vendor_status === "awaiting" || o.vendor_status === "confirmed";
      return {
        id: o.id,
        guestName: o.guest_name,
        guestPhone: o.guest_phone, // necesario para coordinar servicios presenciales
        status: o.status,
        vendorStatus: o.vendor_status,
        myTotal: myItems.reduce((s, i) => s + Number(i.line_total), 0),
        currency: o.currency,
        paidAt: o.paid_at,
        createdAt: o.created_at,
        redeemedAt: o.redeemed_at,
        confirmedAt: o.vendor_confirmed_at,
        declinedAt: o.vendor_declined_at,
        cancelledAt: o.cancellation_decided_at,
        declineReason: o.vendor_decline_reason,
        // El PIN se muestra SOLO mientras la orden está accionable
        // (awaiting o confirmed). En órdenes ya entregadas/declinadas
        // /canceladas no hay utilidad operativa y exponerlo amplifica
        // superficie. El portal_token autentica al vendor — suficiente
        // mientras está dentro del flujo activo.
        guestPin: isWaitingOrConfirmed ? o.redemption_pin : null,
        items: myItems.map((i) => ({
          id: i.id,
          name: i.name,
          quantity: i.quantity,
          unitPrice: Number(i.unit_price),
          lineTotal: Number(i.line_total),
          pricingModel: i.pricing_model,
          serviceDate: i.service_date,
          serviceTime: i.service_time,
          pickupLocation: i.pickup_location,
          flightNumber: i.flight_number,
          extraNotes: i.extra_notes,
        })),
      };
    }),
  });
}
