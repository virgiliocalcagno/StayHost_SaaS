import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

// PATCH /api/payouts/:id
// Body: { status: 'paid'|'cancelled', paymentMethod?, reference?, notes? }
//
// Solo admin. Marca un payout como pagado (con método y referencia) o
// cancelado. Si lo cancela, los payout_items quedan pero pueden re-asignarse
// a otro corte (la UNIQUE solo bloquea duplicados, no reasignación post-cancel).

const VALID_METHODS = new Set(["cash", "transfer", "paypal", "other"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user || !tenantId) {
    return NextResponse.json({ error: "No tenant" }, { status: 403 });
  }

  const { data: viewerRow } = await supabase
    .from("team_members")
    .select("id, role")
    .eq("auth_user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const viewer = viewerRow as { id: string; role: string } | null;
  if (viewer && viewer.role !== "admin") {
    return NextResponse.json({ error: "Solo admin actualiza payouts" }, { status: 403 });
  }

  let body: {
    status?: string;
    paymentMethod?: string;
    reference?: string;
    notes?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.status === "paid") {
    if (!body.paymentMethod || !VALID_METHODS.has(body.paymentMethod)) {
      return NextResponse.json(
        { error: "paymentMethod requerido (cash|transfer|paypal|other)" },
        { status: 400 },
      );
    }
    patch.status = "paid";
    patch.payment_method = body.paymentMethod;
    patch.reference = body.reference || null;
    patch.notes = body.notes || null;
    patch.paid_at = new Date().toISOString();
    if (viewer?.id) patch.paid_by = viewer.id;
  } else if (body.status === "cancelled") {
    patch.status = "cancelled";
    patch.notes = body.notes || null;
  } else if (body.status === "pending") {
    // Re-abrir un payout cancelado/pagado por error (cambio de admin)
    patch.status = "pending";
    patch.payment_method = null;
    patch.reference = null;
    patch.paid_at = null;
    patch.paid_by = null;
  } else {
    return NextResponse.json(
      { error: "status inválido (paid|cancelled|pending)" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("payouts")
    .update(patch as never)
    .eq("id", id)
    .select("id, status, paid_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true, payout: data });
}
