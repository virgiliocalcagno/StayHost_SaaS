/**
 * /api/me — devuelve la identidad del usuario autenticado.
 *
 * Lee la sesión DESDE EL SERVIDOR (via la cookie httpOnly que maneja
 * @supabase/ssr), por lo que es la fuente de verdad más confiable. El SDK
 * de Supabase en el navegador puede tardar o fallar en reconocer la sesión
 * en incógnito o tras borrar caché; este endpoint no tiene ese problema.
 *
 * Responde:
 *   { email, tenantId, isMaster, plan }
 *
 * `plan` viene de la columna tenants.plan ('starter' | 'growth' | 'master').
 * El cliente lo usa para llamar applyPlan() y filtrar modulos por plan real.
 *
 * Nunca 401 — devuelve nulls cuando no hay sesión, para que el cliente pueda
 * decidir qué hacer sin tener que manejar errores.
 */
import { NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

const MASTER_EMAIL = (process.env.NEXT_PUBLIC_MASTER_EMAIL || "virgiliocalcagno@gmail.com").trim().toLowerCase();

export async function GET() {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  const email = (user?.email ?? "").trim().toLowerCase();

  let plan: string | null = null;
  let planExpiresAt: string | null = null;
  let onboarded = true;
  let trialExpired = false;
  let moduleOverrides: Record<string, boolean> = {};

  if (tenantId) {
    const { data } = await supabase
      .from("tenants")
      .select("plan, plan_expires_at, onboarding_completed_at, module_overrides")
      .eq("id", tenantId)
      .single();
    const row = data as {
      plan: string | null;
      plan_expires_at: string | null;
      onboarding_completed_at: string | null;
      module_overrides: Record<string, boolean> | null;
    } | null;
    plan = row?.plan ?? null;
    planExpiresAt = row?.plan_expires_at ?? null;
    onboarded = !!row?.onboarding_completed_at;
    moduleOverrides = row?.module_overrides ?? {};
    // Trial expirado: tenants en plan='trial' cuyo plan_expires_at ya pasó.
    // El Master nunca se considera expirado — siempre tiene acceso.
    if (
      plan === "trial" &&
      planExpiresAt &&
      new Date(planExpiresAt).getTime() < Date.now() &&
      email !== MASTER_EMAIL
    ) {
      trialExpired = true;
    }
  }

  // Auto-promover staff: si este user matchea un team_member con
  // status='pending', lo movemos a 'active' (el primer login exitoso es
  // la confirmación implícita de que la cuenta funciona). Best-effort —
  // si falla no bloqueamos /api/me.
  if (user?.id) {
    await supabase
      .from("team_members")
      .update({ status: "active" })
      .eq("auth_user_id", user.id)
      .eq("status", "pending")
      .then(() => undefined, (e) =>
        console.warn("[/api/me] promote pending→active failed", e)
      );
  }

  return NextResponse.json({
    email: email || null,
    tenantId: tenantId ?? null,
    isMaster: email === MASTER_EMAIL,
    plan,
    planExpiresAt,
    onboarded,
    trialExpired,
    moduleOverrides,
  });
}
