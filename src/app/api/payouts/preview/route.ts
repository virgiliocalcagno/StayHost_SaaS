import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

// POST /api/payouts/preview
// Body: { periodStart: 'YYYY-MM-DD', periodEnd: 'YYYY-MM-DD', memberIds?: string[] }
//
// Devuelve un preview de qué tareas de limpieza están listas para
// liquidar en ese rango (validated_at != null, sin payout_item para
// el rol cleaner) agrupadas por miembro. NO crea filas.
//
// Solo admin del tenant puede llamar. El preview existe para que el
// admin confirme montos antes de "Generar corte".

interface RawTask {
  id: string;
  due_date: string;
  validated_at: string;
  property_id: string | null;
  cleaner_payout: number | string | null;
  currency: string | null;
  assignee_id: string | null;
  properties: { name: string | null; default_cleaner_payout: number | string | null } | null;
}

interface PreviewItem {
  taskId: string;
  propertyName: string;
  dueDate: string;
  validatedAt: string;
  amount: number;
}

interface MemberBucket {
  memberId: string;
  memberName: string;
  memberRole: string;
  employmentType: string;
  total: number;
  currency: string;
  itemCount: number;
  items: PreviewItem[];
}

export async function POST(req: NextRequest) {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user || !tenantId) {
    return NextResponse.json({ error: "No tenant" }, { status: 403 });
  }

  // Solo admin (o el owner sin team_member) puede generar cortes.
  const { data: viewerRow } = await supabase
    .from("team_members")
    .select("role")
    .eq("auth_user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const viewer = viewerRow as { role: string } | null;
  if (viewer && viewer.role !== "admin") {
    return NextResponse.json({ error: "Solo admin genera cortes" }, { status: 403 });
  }

  let body: { periodStart?: string; periodEnd?: string; memberIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { periodStart, periodEnd, memberIds } = body;
  if (!periodStart || !periodEnd) {
    return NextResponse.json(
      { error: "periodStart y periodEnd requeridos (YYYY-MM-DD)" },
      { status: 400 },
    );
  }
  if (periodEnd < periodStart) {
    return NextResponse.json({ error: "periodEnd < periodStart" }, { status: 400 });
  }

  // 1. Tareas validadas en el rango.
  let q = supabase
    .from("cleaning_tasks")
    .select(
      "id, due_date, validated_at, property_id, cleaner_payout, currency, assignee_id, properties:property_id(name, default_cleaner_payout)",
    )
    .eq("tenant_id", tenantId)
    .not("validated_at", "is", null)
    .gte("validated_at", periodStart + "T00:00:00Z")
    .lte("validated_at", periodEnd + "T23:59:59Z")
    .not("assignee_id", "is", null);

  if (memberIds && memberIds.length > 0) {
    q = q.in("assignee_id", memberIds);
  }

  const { data: tasksData, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tasks = (tasksData ?? []) as unknown as RawTask[];
  if (tasks.length === 0) {
    return NextResponse.json({ buckets: [], totalAmount: 0, currency: "DOP" });
  }

  // 2. Excluir tareas ya liquidadas para rol cleaner.
  const taskIds = tasks.map(t => t.id);
  const { data: alreadyLiquidated } = await supabase
    .from("payout_items")
    .select("cleaning_task_id")
    .eq("role", "cleaner")
    .in("cleaning_task_id", taskIds);
  const liquidatedSet = new Set(
    ((alreadyLiquidated ?? []) as { cleaning_task_id: string }[]).map(r => r.cleaning_task_id),
  );

  const elegibles = tasks.filter(t => !liquidatedSet.has(t.id));

  // 3. Resolver miembros y filtrar employees (no se les paga via wallet).
  const assigneeIds = Array.from(new Set(elegibles.map(t => t.assignee_id!).filter(Boolean)));
  const { data: members } = await supabase
    .from("team_members")
    .select("id, name, role, employment_type")
    .in("id", assigneeIds);
  const memberMap = new Map<string, { name: string; role: string; employment_type: string }>();
  for (const m of (members ?? []) as { id: string; name: string; role: string; employment_type: string }[]) {
    memberMap.set(m.id, m);
  }

  // 4. Agrupar por miembro contractor.
  const bucketMap = new Map<string, MemberBucket>();
  let totalAmount = 0;
  let currency = "DOP";

  for (const t of elegibles) {
    const member = memberMap.get(t.assignee_id!);
    if (!member) continue;
    if (member.employment_type === "employee") continue; // no se les paga vía wallet

    const amountRaw = t.cleaner_payout ?? t.properties?.default_cleaner_payout;
    if (amountRaw == null) continue; // tarea sin precio configurado, se omite
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    if (t.currency) currency = t.currency;

    let bucket = bucketMap.get(t.assignee_id!);
    if (!bucket) {
      bucket = {
        memberId: t.assignee_id!,
        memberName: member.name,
        memberRole: member.role,
        employmentType: member.employment_type,
        total: 0,
        currency,
        itemCount: 0,
        items: [],
      };
      bucketMap.set(t.assignee_id!, bucket);
    }
    bucket.items.push({
      taskId: t.id,
      propertyName: t.properties?.name ?? "Propiedad",
      dueDate: t.due_date,
      validatedAt: t.validated_at,
      amount,
    });
    bucket.total += amount;
    bucket.itemCount += 1;
    totalAmount += amount;
  }

  const buckets = Array.from(bucketMap.values()).sort((a, b) => b.total - a.total);

  return NextResponse.json({
    buckets,
    totalAmount,
    currency,
    periodStart,
    periodEnd,
  });
}
