import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

// GET /api/payouts
// Query: ?status=pending|paid|cancelled (opcional)
//
// Admin: lista todos los payouts del tenant.
// Supervisor: lista los payouts de los miembros bajo su coordinación
//   (read-only — no genera ni paga).
// Cleaner contractor: solo los suyos.
// Cleaner employee: 403, no debería ver esta sección.

interface PayoutRow {
  id: string;
  member_id: string;
  period_start: string;
  period_end: string;
  total_amount: string | number;
  currency: string;
  status: string;
  payment_method: string | null;
  reference: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
}

export async function GET(req: NextRequest) {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user || !tenantId) {
    return NextResponse.json({ error: "No tenant" }, { status: 403 });
  }

  const { data: viewerRow } = await supabase
    .from("team_members")
    .select("id, role, employment_type")
    .eq("auth_user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const viewer = viewerRow as
    | { id: string; role: string; employment_type: string }
    | null;

  // Owner sin team_member ⇒ admin
  const isAdmin = !viewer || viewer.role === "admin";
  const isSupervisor = viewer?.role === "supervisor";
  const isContractorOperator =
    !!viewer &&
    (viewer.role === "cleaner" || viewer.role === "maintenance") &&
    viewer.employment_type === "contractor";

  if (viewer && viewer.employment_type === "employee") {
    return NextResponse.json(
      { error: "Como empleado fijo, los pagos no se gestionan acá." },
      { status: 403 },
    );
  }

  const status = req.nextUrl.searchParams.get("status");

  let query = supabase
    .from("payouts")
    .select(
      "id, member_id, period_start, period_end, total_amount, currency, status, payment_method, reference, paid_at, notes, created_at",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);

  if (isContractorOperator) {
    query = query.eq("member_id", viewer!.id);
  } else if (isSupervisor) {
    // Supervisor: ve payouts de quienes tienen supervisor_id = él.
    const { data: subteam } = await supabase
      .from("team_members")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("supervisor_id", viewer!.id);
    const subIds = ((subteam ?? []) as { id: string }[]).map(r => r.id);
    if (subIds.length === 0) {
      return NextResponse.json({ payouts: [], viewerRole: "supervisor" });
    }
    query = query.in("member_id", subIds);
  } else if (!isAdmin) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as PayoutRow[];

  // Resolver nombres de miembros en una query.
  const memberIds = Array.from(new Set(rows.map(r => r.member_id)));
  const memberMap = new Map<string, string>();
  if (memberIds.length > 0) {
    const { data: members } = await supabase
      .from("team_members")
      .select("id, name")
      .in("id", memberIds);
    for (const m of (members ?? []) as { id: string; name: string }[]) {
      memberMap.set(m.id, m.name);
    }
  }

  const payouts = rows.map(r => ({
    id: r.id,
    memberId: r.member_id,
    memberName: memberMap.get(r.member_id) ?? "Miembro",
    periodStart: r.period_start,
    periodEnd: r.period_end,
    totalAmount: Number(r.total_amount),
    // Fallback: payouts legacy generados antes de la migración multi-currency
    // pueden tener currency=null. Sin esto, el frontend agrupa por la clave
    // string "null" y renderiza "NULL 12000".
    currency: r.currency ?? "DOP",
    status: r.status,
    paymentMethod: r.payment_method,
    reference: r.reference,
    paidAt: r.paid_at,
    notes: r.notes,
    createdAt: r.created_at,
  }));

  return NextResponse.json({
    payouts,
    viewerRole: viewer?.role ?? "admin",
  });
}
