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
  // Rol resuelto desde team_members: 'cleaner' | 'maintenance' | 'admin' |
  // 'manager' | 'co_host' | 'guest_support' | 'accountant' | 'owner'.
  // null si el user es owner directo (no tiene row en team_members) o si
  // no pertenece al tenant. La UI usa esto para decidir el landing post-login.
  let role: string | null = null;

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

  // Resolver datos del team_member (memberId, name, role) para que el
  // frontend no tenga que hacer lookup adicional en /api/team-members.
  // También combinamos con el auto-promote pending→active para una sola
  // query.
  let memberId: string | null = null;
  let name: string | null = null;
  if (user?.id) {
    const { data: memberRow } = await supabase
      .from("team_members")
      .select("id, name, role, status")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    const member = memberRow as
      | { id: string; name: string; role: string; status: string }
      | null;
    if (member) {
      memberId = member.id;
      name = member.name;
      role = member.role;

      // Auto-promover pending → active al primer login exitoso. Best-effort.
      if (member.status === "pending") {
        await supabase
          .from("team_members")
          .update({ status: "active" })
          .eq("auth_user_id", user.id)
          .then(() => undefined, (e) =>
            console.warn("[/api/me] promote pending→active failed", e)
          );
      }
    }
  }

  return NextResponse.json({
    email: email || null,
    tenantId: tenantId ?? null,
    isMaster: email === MASTER_EMAIL,
    role,
    memberId,
    name,
    plan,
    planExpiresAt,
    onboarded,
    trialExpired,
    moduleOverrides,
  });
}
