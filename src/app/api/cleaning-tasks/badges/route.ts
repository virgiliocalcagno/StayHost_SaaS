import { NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

/**
 * GET /api/cleaning-tasks/badges
 *
 * Conteos agregados livianos para mostrar badges en el sidebar del dashboard
 * sin tener que cargar todo /api/cleaning-tasks. Usado por el item "Limpieza"
 * para indicar al admin que hay tareas esperando aprobación.
 *
 * Por ahora devuelve sólo el total pendiente. Cuando agreguemos la columna
 * `submitted_for_validation_at` (Sprint B), separamos en `recent` y `overdue`
 * para escalar visualmente las que llevan >2h sin acción.
 */
export async function GET() {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ pendingValidation: 0 });
  }

  const { count } = await supabase
    .from("cleaning_tasks")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("is_waiting_validation", true)
    .is("validated_at", null);

  return NextResponse.json({ pendingValidation: count ?? 0 });
}
