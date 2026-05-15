/**
 * PATCH /api/service-orders/[id]
 *
 * Acciones del host sobre una orden. Allow-list de status:
 *   - paid → completed   (servicio entregado)
 *   - pending → cancelled (orden no se llegó a pagar, cancelar para limpiar)
 *
 * NO permite paid → refunded por acá. El refund real (que también dispara la
 * devolución en PayPal) se hace en POST /api/service-orders/[id]/refund.
 * Antes esta PATCH aceptaba paid → refunded como simple flag de estado, lo
 * que dejaba la orden marcada como reembolsada SIN dinero devuelto al
 * huésped — riesgo financiero serio si alguien lo invocaba por error.
 *
 * Tampoco permite transiciones a `paid` desde el panel (eso lo hace solo el
 * endpoint público de capture al cobrar PayPal).
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

const MANAGE_ROLES = new Set(["owner", "admin", "manager", "co_host"]);

// Allow-list de transiciones que el host puede hacer desde el panel.
// "refunded" se logra SOLO vía POST /refund (que llama a PayPal API).
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending: ["cancelled"],
  paid: ["completed"],
  completed: [], // estado final
  cancelled: [], // estado final
  refunded: [],  // estado final
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user?.id || !tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  // Role guard. null row = owner directo, OK. Si hay row en team_members,
  // exigimos rol en allow-list. Antes el check `if (row && row.role && ...)`
  // dejaba pasar un team_member con role=null silenciosamente — ahora si
  // hay row, debe tener role válido en MANAGE_ROLES.
  const { data: memberRow } = await supabase
    .from("team_members")
    .select("role")
    .eq("auth_user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const member = memberRow as { role: string | null } | null;
  if (member !== null) {
    if (!member.role || !MANAGE_ROLES.has(member.role)) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
  }

  let body: { status?: string };
  try {
    body = (await req.json()) as { status?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const newStatus = String(body.status ?? "").trim();
  if (!newStatus) {
    return NextResponse.json({ error: "status requerido" }, { status: 400 });
  }

  // Leer el estado actual para validar la transición.
  const { data: current } = await supabase
    .from("service_orders")
    .select("id, status")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!current) {
    return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  }
  const cur = current as { id: string; status: string };
  const allowed = ALLOWED_TRANSITIONS[cur.status] ?? [];
  if (!allowed.includes(newStatus)) {
    return NextResponse.json(
      { error: `Transición ${cur.status} → ${newStatus} no permitida` },
      { status: 422 },
    );
  }

  const { error, count } = await supabase
    .from("service_orders")
    .update({ status: newStatus } as never, { count: "exact" })
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
