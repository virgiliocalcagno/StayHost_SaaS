import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { mondayOf, addDays, todayIso } from "@/lib/date-utils";

export const DEFAULT_WEEKS = 4;
const MAX_WEEKS = 12;
const MAX_ROWS = 500;
const CURRENCY = "DOP";

type Row = {
  id: string;
  due_date: string;
  validated_at: string;
  property_id: string;
  cleaner_payout: number | string | null;
  currency: string | null;
  properties: { name: string | null; default_cleaner_payout: number | string | null } | null;
};

type WalletTask = {
  taskId: string;
  propertyName: string;
  dueDate: string;
  amount: number | null;
  liquidated: boolean;
};

type WalletWeek = {
  startDate: string;
  endDate: string;
  total: number;
  tasks: WalletTask[];
};

export async function GET(req: NextRequest) {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user || !tenantId) {
    return NextResponse.json({ error: "No tenant" }, { status: 403 });
  }

  const weeksParam = Number(req.nextUrl.searchParams.get("weeks") ?? DEFAULT_WEEKS);
  const weeks = Number.isFinite(weeksParam)
    ? Math.max(1, Math.min(MAX_WEEKS, Math.floor(weeksParam)))
    : DEFAULT_WEEKS;

  const { data: memberRow } = await supabase
    .from("team_members")
    .select("id, name, role, employment_type")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const member = memberRow as
    | { id: string; name: string; role: string; employment_type: string }
    | null;
  if (!member) {
    return NextResponse.json(
      { error: "No team_member para este usuario" },
      { status: 403 },
    );
  }

  // Employees no ven montos. La wallet es solo para contractors.
  if (member.employment_type === "employee") {
    return NextResponse.json(
      {
        error:
          "Como empleado fijo, tus pagos no se gestionan desde acá. Hablá con tu administrador.",
      },
      { status: 403 },
    );
  }

  const cutoff = mondayOf(addDays(todayIso(), -weeks * 7));

  const { data: tasksData, error } = await supabase
    .from("cleaning_tasks")
    .select(
      "id, due_date, validated_at, property_id, cleaner_payout, currency, properties:property_id(name, default_cleaner_payout)",
    )
    .eq("assignee_id", member.id)
    .not("validated_at", "is", null)
    .gte("validated_at", cutoff + "T00:00:00Z")
    .order("validated_at", { ascending: false })
    .limit(MAX_ROWS);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (tasksData ?? []) as unknown as Row[];

  // Set de tareas ya liquidadas para este cleaner. Las marcamos como
  // "liquidada" en la wallet para que no se mezclen con el pendiente actual.
  const taskIds = rows.map(r => r.id);
  const liquidatedSet = new Set<string>();
  if (taskIds.length > 0) {
    const { data: items } = await supabase
      .from("payout_items")
      .select("cleaning_task_id")
      .eq("role", "cleaner")
      .in("cleaning_task_id", taskIds);
    for (const it of (items ?? []) as { cleaning_task_id: string }[]) {
      liquidatedSet.add(it.cleaning_task_id);
    }
  }

  const buckets = new Map<string, WalletWeek>();
  let totalPending = 0;
  // Moneda de la primera tarea con currency. Default DOP. Mezclar monedas
  // dentro de la wallet de un cleaner es un caso edge fuera del MVP.
  let currency = CURRENCY;

  for (const r of rows) {
    const wkStart = mondayOf(r.validated_at.slice(0, 10));
    const wkEnd = addDays(wkStart, 6);
    // Prefiere el monto override de la tarea; si no existe, cae al default
    // de la propiedad (compat para tareas creadas antes del trigger).
    const amountRaw =
      r.cleaner_payout ?? r.properties?.default_cleaner_payout;
    const amount = amountRaw == null ? null : Number(amountRaw);
    if (r.currency) currency = r.currency;
    const isLiquidated = liquidatedSet.has(r.id);

    let bucket = buckets.get(wkStart);
    if (!bucket) {
      bucket = { startDate: wkStart, endDate: wkEnd, total: 0, tasks: [] };
      buckets.set(wkStart, bucket);
    }
    bucket.tasks.push({
      taskId: r.id,
      propertyName: r.properties?.name ?? "Propiedad",
      dueDate: r.due_date,
      amount,
      liquidated: isLiquidated,
    });
    // El total pendiente solo cuenta tareas NO liquidadas todavía.
    if (amount != null && !isLiquidated) {
      bucket.total += amount;
      totalPending += amount;
    }
  }

  const orderedWeeks = Array.from(buckets.values()).sort((a, b) =>
    b.startDate.localeCompare(a.startDate),
  );

  // Cortes liquidados: lista los payouts del miembro para mostrar el historial
  // ("pagado el X por método Y, ref Z").
  const { data: payoutsRows } = await supabase
    .from("payouts")
    .select("id, period_start, period_end, total_amount, currency, status, payment_method, reference, paid_at")
    .eq("member_id", member.id)
    .order("created_at", { ascending: false })
    .limit(20);

  const payouts = ((payoutsRows ?? []) as {
    id: string;
    period_start: string;
    period_end: string;
    total_amount: string | number;
    currency: string;
    status: string;
    payment_method: string | null;
    reference: string | null;
    paid_at: string | null;
  }[]).map(p => ({
    id: p.id,
    periodStart: p.period_start,
    periodEnd: p.period_end,
    totalAmount: Number(p.total_amount),
    // Fallback: payouts legacy generados antes de la migración multi-currency
    // pueden tener currency=null. Sin esto el cleaner ve "null" en su
    // historial de pagos. Mismo patrón que /api/payouts/route.ts.
    currency: p.currency ?? "DOP",
    status: p.status,
    paymentMethod: p.payment_method,
    reference: p.reference,
    paidAt: p.paid_at,
  }));

  return NextResponse.json({
    cleanerName: member.name,
    weeks: orderedWeeks,
    weeksRequested: weeks,
    totalPending,
    currency,
    payouts,
    note: "El monto se acredita cuando el dueño marca el pago. Las tareas marcadas como 'Liquidada' ya están en un corte cerrado.",
  });
}
