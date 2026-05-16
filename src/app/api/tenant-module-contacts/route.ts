/**
 * /api/tenant-module-contacts
 *
 * CRUD del directorio "Encargados por módulo" del tenant.
 *
 *   GET    → devuelve TODOS los contacts del tenant + el fallback del owner
 *            como hint para el form.
 *   PATCH  → upsert de UN contact: { module, name?, email?, whatsapp? }
 *            Si los 3 campos son null/vacío, hace DELETE (limpia el row).
 *
 * Auth: sesión + role MANAGE_ROLES (owner/admin/manager/co_host).
 *
 * RLS de tenant_module_contacts ya filtra por current_tenant_id() — el
 * filtro explícito acá es defensa en profundidad.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import type { TenantModule } from "@/lib/tenant/module-contact";
import type { SupabaseClient } from "@supabase/supabase-js";

const MANAGE_ROLES = new Set(["owner", "admin", "manager", "co_host"]);

const VALID_MODULES = new Set<TenantModule>([
  "shop",
  "cleaning",
  "checkin",
  "maintenance",
  "reservations",
  "support",
]);

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const E164 = /^\+[1-9]\d{6,14}$/;

async function checkRole(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("team_members")
    .select("role")
    .eq("auth_user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const member = data as { role: string | null } | null;
  if (member === null) return true; // owner directo (sin row en team_members)
  return !!member.role && MANAGE_ROLES.has(member.role);
}

export async function GET() {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user?.id || !tenantId) {
    return NextResponse.json({ error: "No tenant linked" }, { status: 403 });
  }
  if (!(await checkRole(supabase, user.id, tenantId))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const [{ data: contacts }, { data: tenant }] = await Promise.all([
    supabase
      .from("tenant_module_contacts")
      .select("module, name, email, whatsapp, updated_at")
      .eq("tenant_id", tenantId),
    supabase
      .from("tenants")
      .select("contact_email, email, owner_whatsapp")
      .eq("id", tenantId)
      .single(),
  ]);

  const t = tenant as {
    contact_email: string | null;
    email: string;
    owner_whatsapp: string | null;
  } | null;

  return NextResponse.json({
    contacts: ((contacts ?? []) as Array<{
      module: string;
      name: string | null;
      email: string | null;
      whatsapp: string | null;
      updated_at: string;
    }>).map((c) => ({
      module: c.module,
      name: c.name,
      email: c.email,
      whatsapp: c.whatsapp,
      updatedAt: c.updated_at,
    })),
    // Fallback del owner — la UI lo muestra como "si dejás vacío, cae acá".
    ownerFallback: {
      email: t?.contact_email ?? t?.email ?? null,
      whatsapp: t?.owner_whatsapp ?? null,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user?.id || !tenantId) {
    return NextResponse.json({ error: "No tenant linked" }, { status: 403 });
  }
  if (!(await checkRole(supabase, user.id, tenantId))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  let body: { module?: string; name?: string | null; email?: string | null; whatsapp?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const moduleKey = String(body.module ?? "").trim();
  if (!VALID_MODULES.has(moduleKey as TenantModule)) {
    return NextResponse.json(
      { error: `module debe ser uno de: ${[...VALID_MODULES].join(", ")}` },
      { status: 400 },
    );
  }

  const name = body.name == null ? null : String(body.name).trim() || null;
  const email = body.email == null ? null : String(body.email).trim().toLowerCase() || null;
  const whatsapp = body.whatsapp == null ? null : String(body.whatsapp).trim() || null;

  if (name && name.length > 120) {
    return NextResponse.json({ error: "name demasiado largo" }, { status: 400 });
  }
  if (email && (!EMAIL_RE.test(email) || email.length > 254)) {
    return NextResponse.json({ error: "email inválido" }, { status: 400 });
  }
  if (whatsapp && !E164.test(whatsapp)) {
    return NextResponse.json(
      { error: "whatsapp debe estar en formato +1234567890" },
      { status: 400 },
    );
  }

  // Si los 3 campos son null/vacío, DELETE en lugar de UPDATE.
  // Esto deja la tabla limpia sin rows vacías y permite re-crear.
  if (!name && !email && !whatsapp) {
    await supabase
      .from("tenant_module_contacts")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("module", moduleKey);
    return NextResponse.json({ ok: true, action: "deleted" });
  }

  // Upsert: si ya existe (unique tenant+module) lo actualiza.
  const { error } = await supabase
    .from("tenant_module_contacts")
    .upsert(
      {
        tenant_id: tenantId,
        module: moduleKey,
        name,
        email,
        whatsapp,
      } as never,
      { onConflict: "tenant_id,module" },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, action: "upserted" });
}
