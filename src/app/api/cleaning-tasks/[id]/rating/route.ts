import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

// POST /api/cleaning-tasks/[id]/rating
// Body: { stars: 1-5, note?: string }
//
// Crea o actualiza el rating del usuario actual sobre la tarea. Solo
// supervisor/owner/admin/manager pueden ratear (no el cleaner sobre sí
// mismo). El cleaner_id se deriva del task.assignee_id — no se trustea
// del cliente. La unique constraint (task_id, rated_by) hace que reratear
// pise la rating anterior.

const ALLOWED_RATER_ROLES = new Set(["supervisor", "owner", "admin", "manager"]);

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id: taskId } = await ctx.params;
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user || !tenantId) {
    return NextResponse.json({ error: "No tenant" }, { status: 403 });
  }

  let body: { stars?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const stars = Number(body.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return NextResponse.json({ error: "stars must be int 1-5" }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;

  // Resolver rol y memberId del rater desde team_members (auth_user_id).
  // Owner directo (sin team_member) cuenta como "owner".
  const { data: raterRow } = await supabase
    .from("team_members")
    .select("id, role")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const rater = raterRow as { id: string; role: string } | null;
  const raterRole = rater?.role ?? "owner";
  if (!ALLOWED_RATER_ROLES.has(raterRole)) {
    return NextResponse.json(
      { error: "rol no autorizado para calificar" },
      { status: 403 },
    );
  }

  // Tarea: verificar que pertenece al tenant + tomar assignee_id.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: taskRow } = await (supabase.from("cleaning_tasks") as any)
    .select("id, tenant_id, assignee_id, status, validated_at")
    .eq("id", taskId)
    .maybeSingle();
  const task = taskRow as
    | { id: string; tenant_id: string; assignee_id: string | null; status: string | null; validated_at: string | null }
    | null;
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (task.tenant_id !== tenantId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!task.assignee_id) {
    return NextResponse.json(
      { error: "no hay cleaner asignado para calificar" },
      { status: 400 },
    );
  }
  if (task.status !== "completed") {
    return NextResponse.json(
      { error: "solo se califican tareas completadas" },
      { status: 400 },
    );
  }
  if (rater && rater.id === task.assignee_id) {
    return NextResponse.json(
      { error: "no podés calificarte a vos mismo" },
      { status: 400 },
    );
  }

  // Upsert por (task_id, rated_by). Si rater es owner directo (rater=null),
  // rated_by va NULL — pero entonces no podemos diferenciar dos owners
  // ratendo. Por ahora aceptamos esta limitación; en el futuro un owner
  // tendría su propio team_member row.
  const ratedBy = rater?.id ?? null;
  const payload = {
    task_id: taskId,
    cleaner_id: task.assignee_id,
    tenant_id: tenantId,
    rated_by: ratedBy,
    rater_role: raterRole,
    stars,
    note,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase.from("cleaning_task_ratings") as any)
    .select("id")
    .eq("task_id", taskId)
    .eq("rated_by", ratedBy ?? null)
    .maybeSingle();

  if (existing) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from("cleaning_task_ratings") as any)
      .update({ stars, note, rater_role: raterRole })
      .eq("id", (existing as { id: string }).id)
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rating: data });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from("cleaning_task_ratings") as any)
    .insert(payload)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rating: data }, { status: 201 });
}

// GET /api/cleaning-tasks/[id]/rating
// Devuelve todas las ratings que existen para esta tarea (puede haber 1 del
// supervisor + 1 del owner). RLS filtra por tenant.
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id: taskId } = await ctx.params;
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) return NextResponse.json({ error: "No tenant" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from("cleaning_task_ratings") as any)
    .select("id, stars, note, rater_role, rated_by, created_at")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ratings: data ?? [] });
}
