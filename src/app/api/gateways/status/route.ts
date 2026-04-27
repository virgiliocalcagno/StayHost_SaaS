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
import { listGatewaysForAccount } from "@/lib/ttlock/gateway-status";

export async function GET() {
  const { tenantId } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1) Cuentas TTLock del tenant.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: accounts } = await (supabaseAdmin.from("ttlock_accounts") as any)
    .select("id")
    .eq("tenant_id", tenantId);
  const accountIds = ((accounts ?? []) as Array<{ id: string }>).map((a) => a.id);
  if (accountIds.length === 0) {
    return NextResponse.json({ gateways: [] });
  }

  // 2) Propiedades del tenant con cerradura (las que nos interesan).
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

  // 3) Listar gateways por cada cuenta. Una cuenta TTLock puede tener
  // varios gateways (uno por propiedad fisicamente). Cacheamos por
  // accountId para no llamar dos veces si dos propiedades usan la misma.
  const gatewaysByAccount = new Map<string, Awaited<ReturnType<typeof listGatewaysForAccount>>>();
  for (const accId of accountIds) {
    try {
      const list = await listGatewaysForAccount({ accountId: accId, tenantId });
      gatewaysByAccount.set(accId, list);
    } catch (err) {
      console.error("[gateways/status] list failed for account:", accId, err);
      gatewaysByAccount.set(accId, []);
    }
  }

  // 4) Resultado: una entrada por propiedad. Si la cuenta tiene varios
  // gateways, devolvemos el primero (la mayoria de hosts tiene 1 gateway
  // por propiedad). Si no hay gateways, isOnline=false con flag.
  const result = properties.map((prop) => {
    if (!prop.ttlock_account_id) {
      return {
        propertyId: prop.id,
        propertyName: prop.name,
        gatewayId: null,
        gatewayName: null,
        networkName: null,
        isOnline: false,
        signal: null,
        reason: "no_account",
      };
    }
    const list = gatewaysByAccount.get(prop.ttlock_account_id) ?? [];
    if (list.length === 0) {
      return {
        propertyId: prop.id,
        propertyName: prop.name,
        gatewayId: null,
        gatewayName: null,
        networkName: null,
        isOnline: false,
        signal: null,
        reason: "no_gateway",
      };
    }
    // Default: primer gateway de la cuenta. Si en el futuro hay
    // ambiguedad podemos cruzar con /v3/gateway/listByLock por lockId.
    const g = list[0];
    return {
      propertyId: prop.id,
      propertyName: prop.name,
      gatewayId: g.gatewayId,
      gatewayName: g.gatewayName,
      networkName: g.networkName,
      isOnline: g.isOnline,
      signal: g.signal,
      reason: null,
    };
  });

  return NextResponse.json({ gateways: result });
}
