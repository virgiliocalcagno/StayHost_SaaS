/**
 * POST /api/guest/claim-orders/verify
 *
 * Segundo paso del flow de reclamar órdenes. El huésped envía el código
 * que recibió por email + el email reclamado, y nosotros:
 *   1. Buscamos el code más reciente no-usado, no-expirado para
 *      (user_id, email).
 *   2. Incrementamos attempts; si llega a 5 sin matchear, invalidamos.
 *   3. Si matchea: marcamos used_at y actualizamos service_orders.
 *      Solo reclamamos órdenes con guest_auth_user_id IS NULL para no
 *      robar órdenes ya asociadas a otro user.
 *
 * Body: { email: string, code: string }
 *
 * Scope cross-tenant — intencional: al reclamar, asociamos TODAS las
 * service_orders con ese guest_email a la cuenta del huésped (sin filtrar
 * por tenant_id). Esto es deliberado porque la cuenta `/cuenta` es del
 * HUÉSPED, no de un host particular: si Virgilio compró shuttle en Hotel
 * A y desayunos en Hotel B usando el mismo email, su cuenta unificada
 * debe mostrar ambos pedidos (mismo modelo que Booking.com o Airbnb).
 *
 * Seguridad: el código se envió al email reclamado, así que solo quien
 * controla esa bandeja puede reclamar. Eve no puede reclamar órdenes de
 * Alice salvo que tenga acceso a la bandeja de Alice — y si la tiene, es
 * Alice a efectos prácticos. El guard `guest_auth_user_id IS NULL`
 * impide robar órdenes ya reclamadas por otro user.
 */
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createHash } from "crypto";

const MAX_ATTEMPTS = 5;

function hashCode(code: string): string {
  return createHash("sha256").update(code.toUpperCase()).digest("hex");
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  let body: { email?: string; code?: string };
  try {
    body = (await req.json()) as { email?: string; code?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  const code = String(body.code ?? "").trim().toUpperCase();
  if (!email || !code || code.length < 4 || code.length > 12) {
    return NextResponse.json({ error: "Email o código inválido" }, { status: 400 });
  }

  // Lookup del code más reciente no-usado para este user+email.
  const { data: codeRow } = await supabaseAdmin
    .from("guest_claim_codes")
    .select("id, code_hash, expires_at, attempts")
    .eq("user_id", user.id)
    .ilike("email", email)
    .is("used_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!codeRow) {
    return NextResponse.json(
      { error: "No hay código pendiente. Pedí uno nuevo." },
      { status: 404 },
    );
  }
  const row = codeRow as {
    id: string;
    code_hash: string;
    expires_at: string;
    attempts: number;
  };

  if (new Date(row.expires_at) < new Date()) {
    return NextResponse.json(
      { error: "Código vencido. Pedí uno nuevo." },
      { status: 410 },
    );
  }

  // Increment atómico vía RPC (anti race condition). Si dos requests
  // llegan al mismo tiempo, solo uno gana — el otro recibe NULL porque
  // attempts ya hubiera pasado el límite. Sin esto, SELECT+UPDATE manual
  // permitía bypasear max_attempts con paralelismo.
  // Los Supabase TS types no conocen aún esta RPC custom — `as never`
  // bypassa los generics. Si regeneramos types con `supabase gen types`,
  // el cast queda redundante pero no rompe.
  const { data: rpcResult } = await supabaseAdmin.rpc(
    "increment_claim_attempts" as never,
    { p_code_id: row.id, p_max_attempts: MAX_ATTEMPTS } as never,
  );
  const newAttempts = rpcResult as number | null;
  if (newAttempts === null) {
    // Code ya agotado / vencido / usado por otra request concurrente.
    return NextResponse.json(
      { error: "Demasiados intentos. Pedí un código nuevo." },
      { status: 429 },
    );
  }

  // Validar hash.
  if (hashCode(code) !== row.code_hash) {
    return NextResponse.json(
      { error: "Código incorrecto", attemptsRemaining: MAX_ATTEMPTS - newAttempts },
      { status: 401 },
    );
  }

  // Marcar como usado + reclamar órdenes huérfanas.
  await supabaseAdmin
    .from("guest_claim_codes")
    .update({ used_at: new Date().toISOString() } as never)
    .eq("id", row.id);

  const { data: claimed, error: updErr } = await supabaseAdmin
    .from("service_orders")
    .update({ guest_auth_user_id: user.id } as never)
    .ilike("guest_email", email)
    .is("guest_auth_user_id", null)
    .select("id");

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    claimed: (claimed ?? []).length,
  });
}
