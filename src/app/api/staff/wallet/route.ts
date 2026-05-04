import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

// GET /api/staff/wallet?weeks=4
//
// Devuelve las tareas validated_at del cleaner autenticado, agrupadas por
// semana (lunes-domingo en zona del tenant), con el monto que le corresponde
// según properties.cleaner_payout. Read-only — el "marcar como pagado" vendrá
// en una iteración del lado del owner.
//
// Forma de la respuesta:
// {
//   weeks: [
//     { startDate, endDate, total, taskCount, tasks: [{...}] }
//   ],
//   totalPending: number,
//   currency: "DOP",  // hoy hardcoded; viene de tenant en futuro
// }

const DEFAULT_WEEKS = 4;
const MAX_WEEKS = 12;

// Lunes 00:00 de la semana de una fecha YYYY-MM-DD, en UTC (suficientemente
// preciso para agrupar — no manejamos límites exactos de huso aquí porque
// validated_at es timestamptz y podemos fiarnos del orden cronológico).
function mondayOf(dateIso: string): string {
  const d = new Date(dateIso + "T00:00:00Z");
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ... 6=Sat
  const offset = (day + 6) % 7; // distancia a lunes anterior
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user || !tenantId) {
    return NextResponse.json({ error: "No tenant" }, { status: 403 });
  }

  const weeksParam = Number(req.nextUrl.searchParams.get("weeks") ?? DEFAULT_WEEKS);
  const weeks = Number.isFinite(weeksParam)
    ? Math.max(1, Math.min(MAX_WEEKS, Math.floor(weeksParam)))
    : DEFAULT_WEEKS;

  // Resolver el cleaner_id del usuario actual desde team_members.
  const { data: memberRow } = await supabase
    .from("team_members")
    .select("id, name, role")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const member = memberRow as { id: string; name: string; role: string } | null;
  if (!member) {
    return NextResponse.json(
      { error: "No team_member para este usuario" },
      { status: 403 },
    );
  }

  // Cutoff: hace `weeks * 7` días, pero alineado al lunes.
  const today = new Date().toISOString().slice(0, 10);
  const cutoffApprox = addDays(today, -weeks * 7);
  const cutoff = mondayOf(cutoffApprox);

  // Tareas validated_at >= cutoff de este cleaner. Joineamos properties para
  // tomar payout y nombre de la propiedad. assignee_id en cleaning_tasks es
  // text — comparamos contra el id del member.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tasksData, error } = await (supabase.from("cleaning_tasks") as any)
    .select("id, due_date, validated_at, status, property_id, properties:property_id(name, cleaner_payout)")
    .eq("assignee_id", member.id)
    .not("validated_at", "is", null)
    .gte("validated_at", cutoff + "T00:00:00Z")
    .order("validated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type Row = {
    id: string;
    due_date: string;
    validated_at: string;
    status: string | null;
    property_id: string;
    properties: { name: string | null; cleaner_payout: number | string | null } | null;
  };
  const rows = (tasksData ?? []) as Row[];

  type WalletTask = {
    taskId: string;
    propertyName: string;
    dueDate: string;
    validatedAt: string;
    amount: number | null;
  };
  type WalletWeek = {
    startDate: string;
    endDate: string;
    total: number;
    taskCount: number;
    tasks: WalletTask[];
  };

  const buckets = new Map<string, WalletWeek>();
  let totalPending = 0;

  for (const r of rows) {
    const validatedDate = r.validated_at.slice(0, 10);
    const wkStart = mondayOf(validatedDate);
    const wkEnd = addDays(wkStart, 6);
    const amountRaw = r.properties?.cleaner_payout;
    const amount =
      amountRaw == null ? null : Number(amountRaw);

    let bucket = buckets.get(wkStart);
    if (!bucket) {
      bucket = { startDate: wkStart, endDate: wkEnd, total: 0, taskCount: 0, tasks: [] };
      buckets.set(wkStart, bucket);
    }
    bucket.tasks.push({
      taskId: r.id,
      propertyName: r.properties?.name ?? "Propiedad",
      dueDate: r.due_date,
      validatedAt: r.validated_at,
      amount,
    });
    bucket.taskCount += 1;
    if (amount != null) {
      bucket.total += amount;
      totalPending += amount;
    }
  }

  const orderedWeeks = Array.from(buckets.values()).sort((a, b) =>
    b.startDate.localeCompare(a.startDate),
  );

  return NextResponse.json({
    cleanerName: member.name,
    weeks: orderedWeeks,
    totalPending,
    currency: "DOP",
    note: "El monto se acredita cuando el dueño marca el pago. Si ves '—' en una tarea, pedile al dueño que configure el monto en la propiedad.",
  });
}
