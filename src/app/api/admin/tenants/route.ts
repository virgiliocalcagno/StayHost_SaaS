import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * /api/admin/tenants — SaaS admin CRUD para dar de alta y listar clientes.
 *
 * Autorización: SÓLO el MASTER (Virgilio). Cualquier otro usuario recibe 403.
 * Usamos el service role porque necesitamos:
 *   - Listar tenants de TODOS los emails, no sólo el propio (RLS lo bloquea).
 *   - Crear usuarios en auth.users (sólo posible con service role).
 *   - Insertar en tenants saltando RLS.
 *
 * Cuando tengamos un sistema de roles real (Fase D), reemplazamos el
 * gate por email hardcoded por un chequeo de rol SUPER_ADMIN en una tabla.
 */

const MASTER_EMAIL = (process.env.NEXT_PUBLIC_MASTER_EMAIL || "virgiliocalcagno@gmail.com").trim().toLowerCase();

// ─── Guard ───────────────────────────────────────────────────────────────────
async function requireMaster() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const email = (user.email ?? "").trim().toLowerCase();
  if (email !== MASTER_EMAIL) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ok: true as const, user };
}

// ─── GET /api/admin/tenants → lista todos los tenants ────────────────────────
//
// Devuelve también el count de propiedades por tenant para la tabla del panel.
export async function GET() {
  const guard = await requireMaster();
  if (!guard.ok) return guard.response;

  const admin = getSupabaseAdmin();
  const { data: tenants, error } = await admin
    .from("tenants")
    .select(
      "id, email, name, company, plan, plan_expires_at, status, last_login_at, created_at, created_by_admin"
    )
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Propiedades por tenant — una query separada para no complicar el select.
  // En escala grande esto se vuelve un agregado, por ahora es aceptable.
  const { data: propRows } = await admin
    .from("properties")
    .select("tenant_id");

  const propCount = new Map<string, number>();
  for (const r of (propRows ?? []) as Array<{ tenant_id: string | null }>) {
    if (!r.tenant_id) continue;
    propCount.set(r.tenant_id, (propCount.get(r.tenant_id) ?? 0) + 1);
  }

  const result = (tenants as Array<{
    id: string;
    email: string;
    name: string | null;
    company: string | null;
    plan: string;
    plan_expires_at: string | null;
    status: string;
    last_login_at: string | null;
    created_at: string;
    created_by_admin: boolean;
  }> | null) ?? [];

  return NextResponse.json({
    tenants: result.map((t) => ({
      id: t.id,
      email: t.email,
      name: t.name ?? t.email,
      company: t.company ?? null,
      plan: t.plan,
      planExpiresAt: t.plan_expires_at,
      status: t.status,
      lastLoginAt: t.last_login_at,
      createdAt: t.created_at,
      createdByAdmin: t.created_by_admin,
      properties: propCount.get(t.id) ?? 0,
    })),
  });
}

// ─── POST /api/admin/tenants → crea un cliente nuevo ─────────────────────────
//
// Body: { email, name, company?, plan?, planMonths? }
//
// Flujo:
//   1. Invita al email en Supabase Auth (manda mail con link "fija contraseña").
//   2. Crea fila en public.tenants con user_id = el recién creado.
//   3. Retorna el tenant creado.
//
// Si el email ya existía en auth.users pero no tenía tenant (caso raro pero
// posible), re-link sin crear usuario duplicado.
export async function POST(req: NextRequest) {
  const guard = await requireMaster();
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim();
  const company = body.company ? String(body.company).trim() : null;
  const plan = body.plan ? String(body.plan) : "trial";
  const planMonths = body.planMonths ? Number(body.planMonths) : 0;

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Email inválido" }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "Nombre requerido" }, { status: 400 });
  }
  if (!["trial", "starter", "growth", "master"].includes(plan)) {
    return NextResponse.json({ error: "Plan inválido" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Paso 1: buscar o crear en auth.users. Usamos inviteUserByEmail — si el
  // user ya existe Supabase lo rechaza y fallback a buscar por email.
  let userId: string | null = null;

  // Primero chequeamos si ya existe (lista paginada; OK para <10k users).
  const { data: existing } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  const found = existing?.users.find(
    (u) => (u.email ?? "").toLowerCase() === email
  );

  if (found) {
    userId = found.id;
  } else {
    // Invita por email — el cliente recibe link para fijar contraseña.
    const { data: invited, error: inviteErr } =
      await admin.auth.admin.inviteUserByEmail(email, {
        data: { invited_as_tenant: true, name },
      });
    if (inviteErr || !invited?.user) {
      return NextResponse.json(
        { error: inviteErr?.message ?? "No se pudo invitar al email" },
        { status: 500 }
      );
    }
    userId = invited.user.id;
  }

  // Paso 2: ¿ya tiene fila en tenants? Si sí, actualizar plan/estado;
  // si no, crear.
  const { data: existingTenant } = await admin
    .from("tenants")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  const planExpiresAt =
    planMonths > 0
      ? new Date(
          Date.now() + planMonths * 30 * 24 * 60 * 60 * 1000
        ).toISOString()
      : null;

  const status = plan === "trial" ? "trial" : "active";

  if (existingTenant) {
    const { error: upErr } = await admin
      .from("tenants")
      .update({
        email,
        name,
        company,
        plan,
        plan_expires_at: planExpiresAt,
        status,
        created_by_admin: true,
      } as never)
      .eq("id", (existingTenant as { id: string }).id);
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      id: (existingTenant as { id: string }).id,
      relinked: true,
    });
  }

  const { data: newTenant, error: insertErr } = await admin
    .from("tenants")
    .insert({
      user_id: userId,
      email,
      name,
      company,
      plan,
      plan_expires_at: planExpiresAt,
      status,
      created_by_admin: true,
    } as never)
    .select("id")
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    id: (newTenant as { id: string }).id,
  });
}

// ─── PATCH /api/admin/tenants → actualiza plan / status / expiración ─────────
//
// Body: { id, plan?, status?, planMonths?, company?, name? }
export async function PATCH(req: NextRequest) {
  const guard = await requireMaster();
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.plan === "string") {
    if (!["trial", "starter", "growth", "master"].includes(body.plan)) {
      return NextResponse.json({ error: "Plan inválido" }, { status: 400 });
    }
    patch.plan = body.plan;
  }
  if (typeof body.status === "string") {
    if (!["active", "trial", "suspended", "churned"].includes(body.status)) {
      return NextResponse.json({ error: "Status inválido" }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (typeof body.planMonths === "number" && body.planMonths > 0) {
    patch.plan_expires_at = new Date(
      Date.now() + body.planMonths * 30 * 24 * 60 * 60 * 1000
    ).toISOString();
  }
  if (typeof body.company === "string") patch.company = body.company.trim() || null;
  if (typeof body.name === "string") patch.name = body.name.trim();

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.from("tenants").update(patch as never).eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// ─── DELETE /api/admin/tenants?id=... → borra tenant + user ──────────────────
//
// Cuidado: esto borra al tenant y todas sus propiedades/bookings (cascade).
// El auth.users linkeado se borra también — si el cliente intenta loguearse
// después, no existe.
export async function DELETE(req: NextRequest) {
  const guard = await requireMaster();
  if (!guard.ok) return guard.response;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = getSupabaseAdmin();

  // Resolver user_id antes de borrar la fila de tenants.
  const { data: tenant } = await admin
    .from("tenants")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();

  const { error: delErr } = await admin.from("tenants").delete().eq("id", id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  const userId = (tenant as { user_id: string | null } | null)?.user_id;
  if (userId) {
    // Silencioso: si falla no revertimos el tenant. El user queda huérfano
    // pero no puede hacer nada (sin fila en tenants no pasa current_tenant_id).
    await admin.auth.admin.deleteUser(userId);
  }

  return NextResponse.json({ ok: true });
}
