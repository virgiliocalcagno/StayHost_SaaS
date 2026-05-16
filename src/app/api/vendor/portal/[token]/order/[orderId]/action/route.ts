/**
 * POST /api/vendor/portal/[token]/order/[orderId]/action
 *
 * Acciones del vendor sobre una orden DESDE su portal permanente
 * (autenticado por portal_token, no por action_token de la orden).
 *
 *   action = 'confirm' → awaiting → confirmed
 *   action = 'decline' → awaiting/confirmed → declined (notifica al host)
 *   action = 'deliver' → confirmed/awaiting → delivered (requiere PIN huésped)
 *
 * Auth: el portal_token autoriza al vendor. Además verificamos que la
 * orden pertenezca a algún item asignado a ese vendor (defensa: alguien
 * con el portal_token de vendor A no puede tocar órdenes del vendor B
 * aunque sepa el order_id).
 *
 * Reuso conceptual del endpoint `/api/public/redeem/[token]/action` que
 * usa action_token (capability del email). Acá la diferencia es que el
 * vendor ya está autenticado por el portal_token; no necesita re-validar.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizePin, isValidPinFormat } from "@/lib/upsell/redemption";
import { sendEmail } from "@/lib/email/send";
import { sendPushToHost } from "@/lib/push/web-push";
import { getModuleContactForTenant } from "@/lib/tenant/module-contact";

type ActionBody = {
  action?: string;
  pin?: string;
  declineReason?: string;
};

const VALID_ACTIONS = new Set(["confirm", "decline", "deliver"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; orderId: string }> },
) {
  const { token, orderId } = await params;
  const normalizedToken = token.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(normalizedToken)) {
    return NextResponse.json({ error: "Token inválido" }, { status: 400 });
  }
  if (!/^[0-9a-f-]{36}$/.test(orderId)) {
    return NextResponse.json({ error: "orderId inválido" }, { status: 400 });
  }

  let body: ActionBody = {};
  try {
    body = (await req.json()) as ActionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = String(body.action ?? "").trim();
  if (!VALID_ACTIONS.has(action)) {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }

  // 1. Resolver vendor por portal_token.
  const { data: vendorRow } = await supabaseAdmin
    .from("upsell_vendors")
    .select("id, tenant_id, active")
    .eq("portal_token", normalizedToken)
    .maybeSingle();
  const vendor = vendorRow as { id: string; tenant_id: string; active: boolean } | null;
  if (!vendor) {
    return NextResponse.json({ error: "Portal no encontrado" }, { status: 404 });
  }
  if (!vendor.active) {
    return NextResponse.json({ error: "Vendor desactivado" }, { status: 403 });
  }

  // 2. Verificar que la orden tiene al menos 1 item asignado a este vendor.
  // Es la defensa que impide tocar órdenes ajenas sabiendo el order_id.
  const { data: itemRow } = await supabaseAdmin
    .from("service_order_items")
    .select("id")
    .eq("order_id", orderId)
    .eq("vendor_id", vendor.id)
    .limit(1)
    .maybeSingle();
  if (!itemRow) {
    return NextResponse.json(
      { error: "Esta orden no te pertenece" },
      { status: 403 },
    );
  }

  // 3. Lookup de la orden.
  const { data: orderRow } = await supabaseAdmin
    .from("service_orders")
    .select(
      "id, tenant_id, status, vendor_status, redemption_pin, guest_name, total_amount, currency",
    )
    .eq("id", orderId)
    .eq("tenant_id", vendor.tenant_id)
    .maybeSingle();

  if (!orderRow) {
    return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  }
  const order = orderRow as {
    id: string;
    tenant_id: string;
    status: string;
    vendor_status: string;
    redemption_pin: string | null;
    guest_name: string;
    total_amount: string | number;
    currency: string;
  };

  if (order.status !== "paid" && order.status !== "completed") {
    return NextResponse.json(
      { error: "La orden no está disponible para gestión" },
      { status: 422 },
    );
  }

  // 4. Transition por action.
  const now = new Date().toISOString();
  let patch: Record<string, unknown> = {};
  let declineReason: string | null = null;

  if (action === "confirm") {
    if (order.vendor_status !== "awaiting") {
      return NextResponse.json(
        { error: `No se puede confirmar desde estado "${order.vendor_status}"` },
        { status: 422 },
      );
    }
    patch = { vendor_status: "confirmed", vendor_confirmed_at: now };
  } else if (action === "decline") {
    if (order.vendor_status !== "awaiting" && order.vendor_status !== "confirmed") {
      return NextResponse.json(
        { error: `No se puede declinar desde estado "${order.vendor_status}"` },
        { status: 422 },
      );
    }
    declineReason = typeof body.declineReason === "string"
      ? body.declineReason.trim().slice(0, 500)
      : null;
    patch = {
      vendor_status: "declined",
      vendor_declined_at: now,
      vendor_decline_reason: declineReason,
    };
  } else if (action === "deliver") {
    if (order.vendor_status !== "confirmed" && order.vendor_status !== "awaiting") {
      return NextResponse.json(
        {
          error:
            order.vendor_status === "delivered"
              ? "Esta orden ya fue marcada como entregada."
              : `No se puede entregar desde estado "${order.vendor_status}"`,
        },
        { status: 422 },
      );
    }
    // PIN del huésped sigue siendo obligatorio aunque el vendor esté
    // autenticado por portal_token — el PIN prueba la presencia física
    // del huésped al momento de la entrega (no es solo auth, es evidencia).
    const rawPin = typeof body.pin === "string" ? normalizePin(body.pin) : "";
    if (!rawPin || !isValidPinFormat(rawPin)) {
      return NextResponse.json(
        { error: "PIN del huésped requerido (6 caracteres)" },
        { status: 400 },
      );
    }
    if (!order.redemption_pin || rawPin !== order.redemption_pin) {
      return NextResponse.json(
        { error: "PIN incorrecto. Verificá con el huésped." },
        { status: 401 },
      );
    }
    patch = { vendor_status: "delivered", redeemed_at: now };
  }

  // 5. UPDATE con guard de estado (CAS contra carrera).
  const { error: upErr } = await supabaseAdmin
    .from("service_orders")
    .update(patch as never)
    .eq("id", order.id)
    .eq("vendor_status", order.vendor_status);

  if (upErr) {
    return NextResponse.json(
      { error: "No se pudo actualizar la orden. Probá de nuevo." },
      { status: 500 },
    );
  }

  // 6. Si decline → notificar al host (igual que el endpoint público).
  if (action === "decline") {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;

    await sendPushToHost({
      tenantId: order.tenant_id,
      payload: {
        title: `⚠️ Vendor declinó: ${order.guest_name}`,
        body: declineReason ?? "Abrí el panel para reasignar o reembolsar.",
        url: `${baseUrl}/dashboard?panel=upsells`,
        tag: `decline-${order.id.slice(0, 8)}`,
      },
    }).catch((e) => {
      console.error("[vendor/portal/action] host push failed:", e);
    });

    try {
      const shopContact = await getModuleContactForTenant(order.tenant_id, "shop", {
        includeAuthEmailFallback: true,
      });
      if (shopContact?.email) {
        const reasonHtml = declineReason
          ? `<p style="margin:8px 0 0;font-size:14px;color:#475569;font-style:italic">"${escapeHtml(declineReason)}"</p>`
          : "";
        await sendEmail({
          to: shopContact.email,
          subject: `⚠️ Vendor declinó la orden de ${order.guest_name}`,
          fromName: "StayHost",
          html: `<!doctype html><html><body style="font-family:-apple-system,sans-serif;background:#f1f5f9;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:28px">
  <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:1.5px;color:#dc2626;text-transform:uppercase">⚠️ Acción requerida</p>
  <h1 style="margin:8px 0 16px;font-size:22px;color:#1e293b">El vendor declinó una reserva pagada</h1>
  <p style="margin:0;font-size:14px;color:#475569;line-height:1.6">
    Hola <strong>${escapeHtml(shopContact.hostName ?? "Host")}</strong>, el vendor de los servicios de <strong>${escapeHtml(order.guest_name)}</strong> rechazó la orden. El huésped ya pagó — tenés que reasignar a otro proveedor o reembolsar.
  </p>
  ${reasonHtml}
  <a href="${baseUrl}/dashboard?panel=upsells" style="display:block;background:#1e293b;color:#fff;padding:14px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;text-align:center;margin-top:20px">Abrir panel de Pedidos →</a>
</div></body></html>`,
        });
      }
    } catch (e) {
      console.error("[vendor/portal/action] decline email failed:", e);
    }
  }

  return NextResponse.json({
    ok: true,
    vendorStatus: patch.vendor_status,
    declineReason: declineReason ?? undefined,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
