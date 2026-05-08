import type { SupabaseClient } from "@supabase/supabase-js";

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
