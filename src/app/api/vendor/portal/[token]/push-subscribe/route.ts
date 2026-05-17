/**
 * POST/DELETE /api/vendor/portal/[token]/push-subscribe
 *
 * Suscripción a push del vendor DESDE su portal permanente. A diferencia
 * de `/api/vendor/push-subscribe` (que requiere una orden + action_token),
 * acá el vendor se puede suscribir ANTES de tener cualquier orden — solo
 * con su portal_token.
 *
 * Caso de uso: el host crea un vendor con email, le manda link al portal,
 * el vendor entra → activa notificaciones → futuras órdenes le llegan
 * por push desde el día 0.
 *
 * Idempotente: upsert sobre endpoint UNIQUE.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

type SubscribeBody = {
  subscription?: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
};

async function resolveVendor(token: string): Promise<{ vendorId: string } | null> {
  const normalized = token.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(normalized)) return null;

  const { data } = await supabaseAdmin
    .from("upsell_vendors")
    .select("id, active")
    .eq("portal_token", normalized)
    .maybeSingle();
  const row = data as { id: string; active: boolean } | null;
  if (!row || !row.active) return null;
  return { vendorId: row.id };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const resolved = await resolveVendor(token);
  if (!resolved) {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }

  let body: SubscribeBody;
  try {
    body = (await req.json()) as SubscribeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sub = body.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: "subscription incompleta" }, { status: 400 });
  }
  if (sub.endpoint.length > 1000) {
    return NextResponse.json({ error: "endpoint demasiado largo" }, { status: 400 });
  }

  const ua = req.headers.get("user-agent")?.slice(0, 500) ?? null;

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

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  // El DELETE no requiere matchear el vendor — el browser ya nos pasó el
  // endpoint específico que quiere des-suscribir. Validamos el token igual
  // como mínima auth pero el filtro real es por endpoint.
  const { token } = await params;
  const resolved = await resolveVendor(token);
  if (!resolved) {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }

  let body: { endpoint?: string };
  try {
    body = (await req.json()) as { endpoint?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const endpoint = String(body.endpoint ?? "").trim();
  if (!endpoint || endpoint.length > 1000) {
    return NextResponse.json({ error: "endpoint inválido" }, { status: 400 });
  }

  await supabaseAdmin
    .from("vendor_push_subscriptions")
    .update({ expired_at: new Date().toISOString() } as never)
    .eq("endpoint", endpoint)
    .eq("vendor_id", resolved.vendorId);

  return NextResponse.json({ ok: true });
}
