/**
 * POST /api/vendor/push-subscribe
 *
 * Endpoint público sin auth. El vendor lo invoca desde /v/[token] cuando
 * concede permiso de notificaciones. Recibe el PushSubscription que
 * generó el browser y lo guarda asociado al vendor de la orden.
 *
 * Auth model: el body trae `redemptionToken` + `actionToken`. Server
 * lookup confirma que el action_token matchea la orden y resuelve el
 * vendor_id real desde los items. Sin esto, alguien con solo el
 * redemption_token podría suscribir a cualquier vendor.
 *
 * Idempotente: si el endpoint ya existe en BD, lo actualizamos (puede
 * pasar que el browser regenere las keys sin cambiar el endpoint).
 *
 * Body: {
 *   redemptionToken: string,
 *   actionToken: string,
 *   subscription: { endpoint, keys: { p256dh, auth } }
 * }
 *
 * DELETE: el vendor puede des-suscribirse — el browser nos pasa el
 * mismo endpoint y nosotros lo marcamos como expired.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

type SubscribeBody = {
  redemptionToken?: string;
  actionToken?: string;
  subscription?: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
};

async function resolveVendorFromOrder(
  redemptionToken: string,
  actionToken: string,
): Promise<{ vendorId: string; tenantId: string } | null> {
  const tokenNorm = redemptionToken.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(tokenNorm)) return null;
  if (!actionToken) return null;

  const { data: order } = await supabaseAdmin
    .from("service_orders")
    .select("id, tenant_id, vendor_action_token")
    .eq("redemption_token", tokenNorm)
    .maybeSingle();
  const o = order as { id: string; tenant_id: string; vendor_action_token: string | null } | null;
  if (!o || !o.vendor_action_token) return null;
  if (!constantTimeEqual(actionToken, o.vendor_action_token)) return null;

  // El vendor real es el de los items. Si hay varios vendors, suscribimos
  // al primero (caso 99%: 1 vendor por orden). Mejora futura: suscribir
  // a todos los vendors del order si hay multi-vendor.
  const { data: items } = await supabaseAdmin
    .from("service_order_items")
    .select("vendor_id")
    .eq("order_id", o.id);
  const itemRows = (items ?? []) as Array<{ vendor_id: string | null }>;
  const vendorId = itemRows.find((i) => !!i.vendor_id)?.vendor_id ?? null;
  if (!vendorId) return null;

  return { vendorId, tenantId: o.tenant_id };
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: NextRequest) {
  let body: SubscribeBody;
  try {
    body = (await req.json()) as SubscribeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const redemptionToken = String(body.redemptionToken ?? "").trim();
  const actionToken = String(body.actionToken ?? "").trim();
  const sub = body.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: "subscription incompleta" }, { status: 400 });
  }
  // Defensa: limitar el largo del endpoint para evitar abuso BD.
  if (sub.endpoint.length > 1000) {
    return NextResponse.json({ error: "endpoint demasiado largo" }, { status: 400 });
  }

  const resolved = await resolveVendorFromOrder(redemptionToken, actionToken);
  if (!resolved) {
    return NextResponse.json(
      { error: "Token inválido o vendor no resoluble" },
      { status: 401 },
    );
  }

  const ua = req.headers.get("user-agent")?.slice(0, 500) ?? null;

  // Upsert sobre endpoint UNIQUE — si el browser regenera la sub para el
  // mismo endpoint con nuevas keys, actualizamos en lugar de fallar.
  const { error } = await supabaseAdmin
    .from("vendor_push_subscriptions")
    .upsert(
      {
        vendor_id: resolved.vendorId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth_key: sub.keys.auth,
        user_agent: ua,
        expired_at: null,
      } as never,
      { onConflict: "endpoint" },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  let body: { endpoint?: string; redemptionToken?: string; actionToken?: string };
  try {
    body = (await req.json()) as {
      endpoint?: string;
      redemptionToken?: string;
      actionToken?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const endpoint = String(body.endpoint ?? "").trim();
  if (!endpoint || endpoint.length > 1000) {
    return NextResponse.json({ error: "endpoint inválido" }, { status: 400 });
  }

  // Mismos tokens que POST — sin esto, un atacante con el endpoint (que es
  // un identificador conocido del push service) podría des-suscribir a
  // cualquier vendor y suprimir sus notificaciones operativas.
  const redemptionToken = String(body.redemptionToken ?? "").trim();
  const actionToken = String(body.actionToken ?? "").trim();
  const resolved = await resolveVendorFromOrder(redemptionToken, actionToken);
  if (!resolved) {
    return NextResponse.json(
      { error: "Token inválido o vendor no resoluble" },
      { status: 401 },
    );
  }

  // Soft-delete: marcar expired pero mantener la row para audit. Scope:
  // solo la suscripción del vendor resuelto — si el endpoint pertenece a
  // otro vendor, la query no encuentra match y no se modifica nada.
  await supabaseAdmin
    .from("vendor_push_subscriptions")
    .update({ expired_at: new Date().toISOString() } as never)
    .eq("endpoint", endpoint)
    .eq("vendor_id", resolved.vendorId);
  return NextResponse.json({ ok: true });
}
