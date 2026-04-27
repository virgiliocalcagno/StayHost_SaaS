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
import { listGatewaysForAccount, getLinkedGatewayId, type GatewayStatus } from "@/lib/ttlock/gateway-status";

export async function GET() {
  const { tenantId } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  // Para mostrar estado correcto necesitamos cruzar dos APIs de TTLock:
  //   /v3/gateway/list         → trae isOnline + networkName + gatewayName
  //                              de TODOS los gateways de la cuenta
  //   /v3/gateway/listByLock   → trae el gatewayId asociado a un lock
  //                              especifico (NO incluye isOnline)
  //
  // El primer instinto fue usar solo listByLock, pero ese endpoint no
  // devuelve isOnline. Resultado: un gateway online aparecia offline
  // para todos los locks. Ahora hacemos: 1 listAll cacheada por
  // accountId + N listByLock por lockId, y matcheamos por gatewayId.

  // 1) listAll por cada accountId distinto.
  const accountIds = Array.from(
    new Set(properties.map((p) => p.ttlock_account_id).filter((x): x is string => Boolean(x)))
  );
  const accountGateways = new Map<string, GatewayStatus[]>();
  await Promise.all(
    accountIds.map(async (accId) => {
      try {
        const list = await listGatewaysForAccount({ accountId: accId, tenantId });
        accountGateways.set(accId, list);
      } catch (err) {
        console.error("[gateways/status] listAll failed for account:", accId, err);
        accountGateways.set(accId, []);
      }
    })
  );

  // 2) Por cada propiedad: listByLock para encontrar gatewayId, despues
  // matchear contra accountGateways para obtener el isOnline real.
  const result = await Promise.all(
    properties.map(async (prop) => {
      const base = {
        propertyId: prop.id,
        propertyName: prop.name,
      };
      if (!prop.ttlock_account_id) {
        return { ...base, gatewayId: null, gatewayName: null, networkName: null, isOnline: false, signal: null, reason: "no_account" as const };
      }
      if (!prop.ttlock_lock_id) {
        return { ...base, gatewayId: null, gatewayName: null, networkName: null, isOnline: false, signal: null, reason: "no_gateway" as const };
      }

      const linked = await getLinkedGatewayId({
        accountId: prop.ttlock_account_id,
        tenantId,
        lockId: String(prop.ttlock_lock_id),
      });
      if (!linked) {
        // El lock fisico existe en TTLock, pero no esta vinculado a un
        // gateway en su cache. Caso real: la cerradura se pareo via
        // bluetooth pero no se hizo el binding al gateway en la app.
        // La cerradura puede seguir funcionando offline pero no se le
        // pueden mandar PINs nuevos via internet.
        return { ...base, gatewayId: null, gatewayName: null, networkName: null, isOnline: false, signal: null, reason: "not_linked" as const };
      }

      const fullList = accountGateways.get(prop.ttlock_account_id) ?? [];
      const gw = fullList.find((g) => g.gatewayId === linked.gatewayId);
      if (!gw) {
        // Raro: listByLock dice que esta vinculado a X pero listAll no
        // tiene a X. Token expirado entre llamadas o gateway recien
        // borrado. Damos signal = rssi del lock pero isOnline=false.
        return { ...base, gatewayId: linked.gatewayId, gatewayName: null, networkName: null, isOnline: false, signal: linked.rssi, reason: "no_gateway" as const };
      }

      return {
        ...base,
        gatewayId: gw.gatewayId,
        gatewayName: gw.gatewayName,
        networkName: gw.networkName,
        isOnline: gw.isOnline,
        // Preferimos rssi del lock especifico (mas relevante para esa
        // cerradura) sobre el signal global del gateway.
        signal: linked.rssi ?? gw.signal,
        reason: null,
      };
    })
  );

  return NextResponse.json({ gateways: result });
}
