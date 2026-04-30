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
import { listGatewaysForAccount, getLinkedGatewayId, type GatewayStatus } from "@/lib/ttlock/gateway-status";

export async function GET() {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS sobre `properties` filtra por tenant del caller — no necesitamos
  // service_role para esta lectura. Mantenemos el `.eq("tenant_id", ...)`
  // por claridad, pero RLS es la barrera real.
  const { data: props } = await supabase
    .from("properties")
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
        // listByLock vacio. Dos causas reales:
        //   a) el lock nunca se vinculo a un gateway en TTLock
        //   b) el gateway esta offline (sin internet) y TTLock cloud
        //      perdio la cache del binding hasta que vuelva
        //
        // Para distinguir: si la cuenta tiene UN gateway offline con
        // lockNum=0 (gateway "huerfano" sin locks reportados), es
        // probable que sea el caso (b) — el lockNum de TTLock no
        // refleja el binding real cuando el gateway esta down.
        const fullList = accountGateways.get(prop.ttlock_account_id) ?? [];
        const offlineGatewaysWithoutLocks = fullList.filter(
          (g) => !g.isOnline && g.lockNum === 0,
        );
        if (offlineGatewaysWithoutLocks.length === 1) {
          const candidate = offlineGatewaysWithoutLocks[0];
          // Reportamos como offline (badge rojo) con el nombre del
          // gateway candidato. Asi el host ve "Emy OFFLINE" en lugar
          // del confuso "sin gateway vinculado".
          return {
            ...base,
            gatewayId: candidate.gatewayId,
            gatewayName: candidate.gatewayName,
            networkName: candidate.networkName,
            isOnline: false,
            signal: null,
            reason: null,
          };
        }
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
