import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Recalcula precios para UNA tarea específica. Usado al reasignar (cuando
 * el assignee_id cambia, el override aplicable cambia con él) y donde se
 * necesite resolución targeted en vez de recompute por propiedad entero.
 *
 * Salta tareas validadas (validated_at IS NOT NULL) por la misma razón que
 * el helper por propiedad: no rehacer cuentas cerradas.
 */
export async function recomputeTaskPricesForTask(
  supabase: SupabaseClient,
  taskId: string,
): Promise<{ updated: boolean }> {
  const { data: task } = await supabase
    .from("cleaning_tasks")
    .select("id, property_id, assignee_id, validated_at")
    .eq("id", taskId)
    .maybeSingle<{
      id: string;
      property_id: string | null;
      assignee_id: string | null;
      validated_at: string | null;
    }>();
  if (!task || !task.property_id || task.validated_at) {
    return { updated: false };
  }

  const { data: prop } = await supabase
    .from("properties")
    .select(
      "default_cleaner_payout, default_supervisor_payout, default_client_price, currency, supervisor_id",
    )
    .eq("id", task.property_id)
    .maybeSingle<{
      default_cleaner_payout: number | null;
      default_supervisor_payout: number | null;
      default_client_price: number | null;
      currency: string | null;
      supervisor_id: string | null;
    }>();
  if (!prop) {
    return { updated: false };
  }

  let cleanerOverride: number | null = null;
  if (task.assignee_id) {
    const { data: o } = await supabase
      .from("cleaning_pricing_overrides")
      .select("amount")
      .eq("property_id", task.property_id)
      .eq("member_id", task.assignee_id)
      .eq("role", "cleaner")
      .maybeSingle<{ amount: string | number }>();
    if (o) cleanerOverride = Number(o.amount);
  }

  let supervisorOverride: number | null = null;
  if (prop.supervisor_id) {
    const { data: o } = await supabase
      .from("cleaning_pricing_overrides")
      .select("amount")
      .eq("property_id", task.property_id)
      .eq("member_id", prop.supervisor_id)
      .eq("role", "supervisor")
      .maybeSingle<{ amount: string | number }>();
    if (o) supervisorOverride = Number(o.amount);
  }

  const patch = {
    cleaner_payout:
      cleanerOverride ?? prop.default_cleaner_payout ?? null,
    supervisor_payout:
      supervisorOverride ?? prop.default_supervisor_payout ?? null,
    client_price: prop.default_client_price ?? null,
    currency: prop.currency || "DOP",
  };
  const { error } = await supabase
    .from("cleaning_tasks")
    .update(patch)
    .eq("id", taskId);
  return { updated: !error };
}

/**
 * Recalcula cleaner_payout, supervisor_payout, client_price y currency
 * de las tareas no validadas de una propiedad. Aplica cuando el dueño
 * cambia los defaults de la propiedad o los overrides por miembro.
 *
 * No toca tareas con `validated_at IS NOT NULL` — esas ya entraron al
 * flujo de payouts y cambiar su precio post-facto sería rehacer cuentas
 * cerradas.
 */
export async function recomputeTaskPricesForProperty(
  supabase: SupabaseClient,
  propertyId: string,
): Promise<{ updated: number }> {
  const { data: prop, error: propErr } = await supabase
    .from("properties")
    .select(
      "default_cleaner_payout, default_supervisor_payout, default_client_price, currency, supervisor_id",
    )
    .eq("id", propertyId)
    .maybeSingle<{
      default_cleaner_payout: number | null;
      default_supervisor_payout: number | null;
      default_client_price: number | null;
      currency: string | null;
      supervisor_id: string | null;
    }>();
  if (propErr || !prop) {
    return { updated: 0 };
  }

  const { data: overrides } = await supabase
    .from("cleaning_pricing_overrides")
    .select("member_id, role, amount")
    .eq("property_id", propertyId);

  const overrideMap = new Map<string, number>();
  for (const o of (overrides ?? []) as Array<{
    member_id: string;
    role: "cleaner" | "supervisor";
    amount: string | number;
  }>) {
    overrideMap.set(`${o.member_id}:${o.role}`, Number(o.amount));
  }

  const { data: tasks } = await supabase
    .from("cleaning_tasks")
    .select("id, assignee_id")
    .eq("property_id", propertyId)
    .is("validated_at", null);

  const taskRows = (tasks ?? []) as Array<{ id: string; assignee_id: string | null }>;
  if (taskRows.length === 0) {
    return { updated: 0 };
  }

  const supOverride =
    prop.supervisor_id != null
      ? overrideMap.get(`${prop.supervisor_id}:supervisor`)
      : undefined;

  let updated = 0;
  for (const t of taskRows) {
    const cleanerOverride = t.assignee_id
      ? overrideMap.get(`${t.assignee_id}:cleaner`)
      : undefined;

    const patch = {
      cleaner_payout: cleanerOverride ?? prop.default_cleaner_payout ?? null,
      supervisor_payout: supOverride ?? prop.default_supervisor_payout ?? null,
      client_price: prop.default_client_price ?? null,
      currency: prop.currency || "DOP",
    };

    const { error } = await supabase
      .from("cleaning_tasks")
      .update(patch)
      .eq("id", t.id);
    if (!error) updated += 1;
  }

  return { updated };
}
