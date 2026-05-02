"use client";

import { useEffect, useRef } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * useTableSync — suscripción Realtime a una tabla Supabase.
 *
 * Diseño:
 *   - Hook genérico, agnóstico de schema. El componente decide qué hacer
 *     en `onChange` (típicamente: refetchear la lista, o mergear el row).
 *   - Auto-cleanup en unmount.
 *   - Re-suscribe cuando cambia el filter (típicamente al cambiar tenantId).
 *   - Si `enabled=false` o `filter` está vacío, no hace nada.
 *
 * Requisitos en BD (una vez por tabla):
 *   alter publication supabase_realtime add table public.<table_name>;
 *
 * Y la RLS debe permitir SELECT al user — el subscriber recibe solo las
 * rows que puede ver. Para tablas filtradas por current_tenant_id() esto
 * ya pasa naturalmente.
 *
 * Uso típico:
 *   useTableSync({
 *     table: "cleaning_tasks",
 *     filter: `tenant_id=eq.${tenantId}`,
 *     enabled: !!tenantId,
 *     onChange: () => refetchTasks(),
 *   });
 */

type Event = "INSERT" | "UPDATE" | "DELETE" | "*";

export type TableSyncOptions<T extends Record<string, unknown> = Record<string, unknown>> = {
  /** Nombre de la tabla en el schema public. */
  table: string;
  /**
   * Filtro de Postgres en formato Supabase Realtime, ej:
   * `tenant_id=eq.<uuid>`. Si vacío o undefined, NO se suscribe.
   */
  filter?: string;
  /**
   * Eventos a escuchar. Default '*' = INSERT + UPDATE + DELETE.
   * Pasá un array para filtrar.
   */
  events?: Event[];
  /** Si false, no se suscribe. Útil para esperar a que tenantId se resuelva. */
  enabled?: boolean;
  /** Callback con el payload completo de Supabase. */
  onChange: (payload: RealtimePostgresChangesPayload<T>) => void;
};

export function useTableSync<T extends Record<string, unknown> = Record<string, unknown>>(
  options: TableSyncOptions<T>
) {
  const { table, filter, events = ["*"], enabled = true, onChange } = options;

  // Guardamos onChange en un ref para que el effect no se re-suscriba en cada
  // render solo porque el caller pasa un closure nuevo. Patrón estándar.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled || !filter) return;

    const supabase = getSupabaseBrowserClient();
    const channelName = `table-sync:${table}:${filter}`;
    const channel = supabase.channel(channelName);

    for (const event of events) {
      // El SDK de Supabase tipa esto demasiado estrictamente para nuestro
      // uso genérico — castear a never aquí es seguro porque todos los
      // valores de `event` son válidos en runtime.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (channel as any).on(
        "postgres_changes",
        {
          event,
          schema: "public",
          table,
          filter,
        },
        (payload: RealtimePostgresChangesPayload<T>) => {
          onChangeRef.current(payload);
        }
      );
    }

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // events es array literal del caller — lo serializamos para detectar
    // cambios reales sin causar re-suscripciones espurias.
  }, [table, filter, enabled, events]);
}
