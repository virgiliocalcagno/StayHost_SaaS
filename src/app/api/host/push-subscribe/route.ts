/**
 * POST/DELETE /api/host/push-subscribe
 *
 * El host se suscribe a push notifications desde el dashboard para
 * recibir alerts críticos (vendor decline, recordatorios futuros, etc).
 *
 * Auth: sesión Supabase del owner/admin/manager del tenant (real auth,
 * a diferencia del endpoint del vendor que usa capability token).
 *
 * Body POST: { subscription: { endpoint, keys: { p256dh, auth } } }
 * Body DELETE: { endpoint }
 *
 * Upsert por endpoint UNIQUE — si el browser regenera keys, replace.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const MANAGE_ROLES = new Set(["owner", "admin", "manager", "co_host"]);

export async function POST(req: NextRequest) {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user?.id || !tenantId) {
    return NextResponse.json({ error: "No tenant linked" }, { status: 403 });
  }

  // Role guard.
  const { data: memberRow } = await supabase
    .from("team_members")
    .select("role")
    .eq("auth_user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const member = memberRow as { role: string | null } | null;
  if (member !== null && (!member.role || !MANAGE_ROLES.has(member.role))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  let body: {
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  };
  try {
    body = (await req.json()) as typeof body;
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
    .from("host_push_subscriptions")
    .upsert(
      {
        tenant_id: tenantId,
        auth_user_id: user.id,
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
  const { user, tenantId } = await getAuthenticatedTenant();
  if (!user?.id || !tenantId) {
    return NextResponse.json({ error: "No tenant linked" }, { status: 403 });
  }

  let body: { endpoint?: string };
  try {
    body = (await req.json()) as { endpoint?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const endpoint = String(body.endpoint ?? "").trim();
  if (!endpoint) {
    return NextResponse.json({ error: "endpoint requerido" }, { status: 400 });
  }
  // Soft-delete + filtro por auth_user_id para que un user no pueda borrar
  // subscriptions de otro user del mismo tenant.
  await supabaseAdmin
    .from("host_push_subscriptions")
    .update({ expired_at: new Date().toISOString() } as never)
    .eq("endpoint", endpoint)
    .eq("auth_user_id", user.id);
  return NextResponse.json({ ok: true });
}
