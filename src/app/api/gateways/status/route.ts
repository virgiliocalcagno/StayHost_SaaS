/**
 * GET /api/gateways/status
 *
 * Devuelve el estado actual (online/offline + WiFi + signal) de todos
 * los gateways TTLock del tenant logueado, agrupados por propiedad.
 *
 * Lo consume el dashboard de Dispositivos para pintar el badge "Gateway
 * online/offline" debajo del estado del lock. Sin este info, el host
 * solo ve "Online" del lock — pero el lock puede mostrar "Online" via
 * cache mientras el gateway esta caido y los PINs nuevos no llegan.
 *
 * Respuesta:
 *   { gateways: [{ propertyId, propertyName, gatewayId, gatewayName,
 *                  networkName, isOnline, signal }] }
 *
 * Si el tenant tiene varias propiedades pero todas comparten el mismo
 * gateway (caso multi-cerradura en un edificio), el endpoint duplica la
 * fila por propiedad para que cada card muestre su badge.
 */
import { NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGatewayForLock } from "@/lib/ttlock/gateway-status";

export async function GET() {
  const { tenantId } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Propiedades del tenant con cerradura (las que nos interesan).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: props } = await (supabaseAdmin.from("properties") as any)
    .select("id, name, ttlock_account_id, ttlock_lock_id")
    .eq("tenant_id", tenantId)
    .not("ttlock_lock_id", "is", null);
  const properties = (props ?? []) as Array<{
    id: string;
    name: string;
    ttlock_account_id: string | null;
    ttlock_lock_id: string | null;
  }>;

  if (properties.length === 0) {
    return NextResponse.json({ gateways: [] });
  }

  // Para CADA cerradura llamamos /v3/gateway/listByLock — esto es lo
  // unico correcto cuando un host tiene multiples propiedades, cada una
  // con su propio gateway en una red WiFi distinta. Antes asumia "1
  // gateway por cuenta" y mostraba el mismo estado en todas.
  //
  // Llamamos en paralelo (Promise.all) para no acumular latencia: 3
  // propiedades = 1 round-trip (~2s) en vez de 6s secuencial.
  const result = await Promise.all(
    properties.map(async (prop) => {
      if (!prop.ttlock_account_id) {
        return {
          propertyId: prop.id,
          propertyName: prop.name,
          gatewayId: null,
          gatewayName: null,
          networkName: null,
          isOnline: false,
          signal: null,
          reason: "no_account" as const,
        };
      }
      if (!prop.ttlock_lock_id) {
        return {
          propertyId: prop.id,
          propertyName: prop.name,
          gatewayId: null,
          gatewayName: null,
          networkName: null,
          isOnline: false,
          signal: null,
          reason: "no_gateway" as const,
        };
      }

      try {
        const gw = await getGatewayForLock({
          accountId: prop.ttlock_account_id,
          tenantId,
          lockId: String(prop.ttlock_lock_id),
        });
        if (!gw) {
          return {
            propertyId: prop.id,
            propertyName: prop.name,
            gatewayId: null,
            gatewayName: null,
            networkName: null,
            isOnline: false,
            signal: null,
            reason: "no_gateway" as const,
          };
        }
        return {
          propertyId: prop.id,
          propertyName: prop.name,
          gatewayId: gw.gatewayId,
          gatewayName: gw.gatewayName,
          networkName: gw.networkName,
          isOnline: gw.isOnline,
          signal: gw.signal,
          reason: null,
        };
      } catch (err) {
        console.error("[gateways/status] listByLock failed for", prop.id, err);
        return {
          propertyId: prop.id,
          propertyName: prop.name,
          gatewayId: null,
          gatewayName: null,
          networkName: null,
          isOnline: false,
          signal: null,
          reason: "no_gateway" as const,
        };
      }
    })
  );

  return NextResponse.json({ gateways: result });
}
