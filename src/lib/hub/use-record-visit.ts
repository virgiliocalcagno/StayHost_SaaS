"use client";

/**
 * Guarda en localStorage los hubs visitados por el huésped.
 *
 * Usado por:
 *   - /hub/[hostId]         → guarda al cargar el hub completo
 *   - /hub/[hostId]/extras  → guarda al cargar la tienda
 *
 * Leído por:
 *   - /cuenta → si el huésped logueado no tiene pedidos, le mostramos los
 *     hubs que visitó como CTAs para volver.
 *
 * Estructura: array de máximo 5 entries, ordenado por visita más reciente.
 *   [{ tenantId: string, name: string, visitedAt: number (ms epoch) }, ...]
 *
 * Solo se guarda cuando ya tenemos el `name` del hub (después del fetch).
 * Sin name no guardamos — el listado en /cuenta se vería feo.
 */

import { useEffect } from "react";

const STORAGE_KEY = "stayhost.recent_hubs";
const MAX_ENTRIES = 5;

type RecentHub = {
  tenantId: string;
  name: string;
  visitedAt: number;
};

export function useRecordHubVisit(tenantId: string | null, name: string | null): void {
  useEffect(() => {
    if (!tenantId || !name) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list: RecentHub[] = raw ? (JSON.parse(raw) as RecentHub[]) : [];
      // Filtrar duplicados del mismo tenant (siempre re-creamos al tope).
      const filtered = list.filter(
        (h) => h && h.tenantId && h.tenantId !== tenantId,
      );
      const updated: RecentHub[] = [
        { tenantId, name, visitedAt: Date.now() },
        ...filtered,
      ].slice(0, MAX_ENTRIES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // localStorage off (private mode) o quota exceeded — ignorar.
    }
  }, [tenantId, name]);
}
