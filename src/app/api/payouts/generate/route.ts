import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

// POST /api/payouts/generate
// Body: {
//   periodStart, periodEnd,
//   buckets: [{ memberId, currency, items: [{ taskId, amount }] }]
// }
//
// Crea un payout en estado 'pending' por cada miembro y los payout_items
// asociados. Idempotente parcial: la UNIQUE (cleaning_task_id, role) impide
// duplicar items, así que si el admin re-genera por error, solo se crean
// los nuevos. Si TODAS las tareas del bucket ya están liquidadas el bucket
// se omite.

interface IncomingItem {
  taskId: string;
  amount: number;
}
interface IncomingBucket {
  memberId: string;
  currency?: string;
  items: IncomingItem[];
}

export async function POST(req: NextRequest) {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user || !tenantId) {
    return NextResponse.json({ error: "No tenant" }, { status: 403 });
  }

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

  let body: { periodStart?: string; periodEnd?: string; buckets?: IncomingBucket[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { periodStart, periodEnd, buckets } = body;
  if (!periodStart || !periodEnd || !Array.isArray(buckets) || buckets.length === 0) {
    return NextResponse.json(
      { error: "periodStart, periodEnd y buckets son requeridos" },
      { status: 400 },
    );
  }

  const created: { payoutId: string; memberId: string; total: number }[] = [];
  const skipped: { memberId: string; reason: string }[] = [];

  for (const b of buckets) {
    if (!b.memberId || !Array.isArray(b.items) || b.items.length === 0) {
      skipped.push({ memberId: b.memberId ?? "?", reason: "bucket vacío" });
      continue;
    }

    // Re-chequear qué tareas ya están liquidadas para evitar trabajo
    // perdido (la UNIQUE las rechazará igual, pero así devolvemos
    // diagnóstico claro).
    const taskIds = b.items.map(i => i.taskId);
    const { data: existing } = await supabase
      .from("payout_items")
      .select("cleaning_task_id")
      .eq("role", "cleaner")
      .in("cleaning_task_id", taskIds);
    const liq = new Set(
      ((existing ?? []) as { cleaning_task_id: string }[]).map(r => r.cleaning_task_id),
    );
    const elegibles = b.items.filter(i => !liq.has(i.taskId));
    if (elegibles.length === 0) {
      skipped.push({ memberId: b.memberId, reason: "todas las tareas ya estaban liquidadas" });
      continue;
    }

    const total = elegibles.reduce((acc, i) => acc + Number(i.amount || 0), 0);
    if (!Number.isFinite(total) || total <= 0) {
      skipped.push({ memberId: b.memberId, reason: "total inválido" });
      continue;
    }

    const { data: payoutInserted, error: payoutErr } = await supabase
      .from("payouts")
      .insert({
        tenant_id: tenantId,
        member_id: b.memberId,
        period_start: periodStart,
        period_end: periodEnd,
        total_amount: total,
        currency: b.currency || "DOP",
        status: "pending",
      } as never)
      .select("id")
      .single();

    if (payoutErr || !payoutInserted) {
      skipped.push({ memberId: b.memberId, reason: payoutErr?.message ?? "insert payout falló" });
      continue;
    }

    const payoutId = (payoutInserted as { id: string }).id;
    const itemsRows = elegibles.map(i => ({
      payout_id: payoutId,
      cleaning_task_id: i.taskId,
      amount: Number(i.amount),
      role: "cleaner" as const,
    }));

    const { error: itemsErr } = await supabase
      .from("payout_items")
      .insert(itemsRows as never);

    if (itemsErr) {
      // Rollback: borrar el payout si los items fallaron.
      await supabase.from("payouts").delete().eq("id", payoutId);
      skipped.push({ memberId: b.memberId, reason: itemsErr.message });
      continue;
    }

    created.push({ payoutId, memberId: b.memberId, total });
  }

  return NextResponse.json({ ok: true, created, skipped });
}
