/**
 * Cliente HTTP minimal para la API REST v2 de PayPal.
 *
 * StayHost no procesa pagos centralmente: cada host trae SUS credenciales
 * (client_id + client_secret) desde tenant_payment_configs. Este módulo
 * resuelve el access_token (cache 9 min en memoria por configId) y expone
 * helpers para crear y capturar órdenes.
 *
 * Modes:
 *   sandbox → https://api-m.sandbox.paypal.com
 *   live    → https://api-m.paypal.com
 *
 * Tokens:
 *   PayPal devuelve un access_token que vive ~9 hrs. Cacheamos en memoria
 *   con TTL conservador (9 min) por configId. El cache se pierde en cada
 *   cold start del serverless — aceptable para volumen bajo.
 */

const TOKEN_URLS = {
  sandbox: "https://api-m.sandbox.paypal.com/v1/oauth2/token",
  live: "https://api-m.paypal.com/v1/oauth2/token",
} as const;

const API_URLS = {
  sandbox: "https://api-m.sandbox.paypal.com",
  live: "https://api-m.paypal.com",
} as const;

type Mode = "sandbox" | "live";

type CachedToken = { token: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

async function getAccessToken(args: {
  configId: string;
  clientId: string;
  clientSecret: string;
  mode: Mode;
}): Promise<string> {
  const cached = tokenCache.get(args.configId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  // Trim defensivo: paste mete trailing/leading spaces y PayPal rechaza
  // con `invalid_client` sin pista de por qué (501h-debug recurrente).
  const clientId = args.clientId.trim();
  const clientSecret = args.clientSecret.trim();
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(TOKEN_URLS[args.mode], {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    let errBody: { error?: string; error_description?: string } = {};
    try {
      errBody = (await res.json()) as typeof errBody;
    } catch {
      /* ignore parse errors */
    }
    if (errBody.error === "invalid_client") {
      throw new Error(
        `PayPal rechazó las credenciales del host (modo ${args.mode}). El host debe verificar en Configuración → Pagos que las claves correspondan al modo seleccionado (Sandbox vs Live tienen claves distintas).`
      );
    }
    throw new Error(
      `PayPal OAuth ${res.status}: ${errBody.error ?? "unknown"} ${errBody.error_description ?? ""}`.trim()
    );
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(args.configId, {
    token: json.access_token,
    expiresAt: Date.now() + Math.min(json.expires_in, 540) * 1000, // máx 9 min
  });
  return json.access_token;
}

export async function createPaypalOrder(args: {
  configId: string;
  clientId: string;
  clientSecret: string;
  mode: Mode;
  amount: number;
  currency: string;
  description?: string;
  customId?: string; // booking id u otro identificador interno
}): Promise<{ id: string; status: string; approveUrl: string | null }> {
  const token = await getAccessToken(args);
  const res = await fetch(`${API_URLS[args.mode]}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: args.currency,
            value: args.amount.toFixed(2),
          },
          description: args.description?.slice(0, 127),
          custom_id: args.customId,
        },
      ],
      application_context: {
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PayPal create-order failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as {
    id: string;
    status: string;
    links: Array<{ href: string; rel: string }>;
  };
  const approve = json.links.find((l) => l.rel === "approve")?.href ?? null;
  return { id: json.id, status: json.status, approveUrl: approve };
}

export async function capturePaypalOrder(args: {
  configId: string;
  clientId: string;
  clientSecret: string;
  mode: Mode;
  orderId: string;
}): Promise<{
  id: string;
  status: string;
  payerEmail: string | null;
  amount: number;
  currency: string;
  /** ID del capture dentro de la orden — necesario para refunds. */
  captureId: string | null;
}> {
  const token = await getAccessToken(args);
  const res = await fetch(`${API_URLS[args.mode]}/v2/checkout/orders/${args.orderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PayPal capture failed: ${res.status} ${text}`);
  }

  const json = (await res.json()) as {
    id: string;
    status: string;
    payer?: { email_address?: string };
    purchase_units?: Array<{
      payments?: {
        captures?: Array<{
          id?: string;
          amount?: { value?: string; currency_code?: string };
        }>;
      };
    }>;
  };

  const cap = json.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    id: json.id,
    status: json.status,
    payerEmail: json.payer?.email_address ?? null,
    amount: Number(cap?.amount?.value ?? 0),
    currency: cap?.amount?.currency_code ?? "USD",
    captureId: cap?.id ?? null,
  };
}

/**
 * Busca el capture_id de una orden PayPal. Útil para órdenes históricas
 * cuyo capture_id no quedó guardado en BD (antes del fix).
 *
 * Devuelve null si la orden no fue capturada o no se encuentra capture.
 */
export async function getPaypalOrderCaptureId(args: {
  configId: string;
  clientId: string;
  clientSecret: string;
  mode: Mode;
  orderId: string;
}): Promise<string | null> {
  const token = await getAccessToken(args);
  const res = await fetch(`${API_URLS[args.mode]}/v2/checkout/orders/${args.orderId}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PayPal get-order failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as {
    purchase_units?: Array<{
      payments?: {
        captures?: Array<{ id?: string; status?: string }>;
      };
    }>;
  };
  // Tomamos el primer capture COMPLETED. Si no hay, devolvemos el primero
  // disponible (PayPal podría devolver PENDING en casos raros — el caller
  // decide qué hacer con eso).
  const captures = json.purchase_units?.[0]?.payments?.captures ?? [];
  const completed = captures.find((c) => c.status === "COMPLETED");
  return (completed?.id ?? captures[0]?.id) ?? null;
}

/**
 * Refunda un capture de PayPal. Sin amount → reembolso total; con amount
 * → parcial. PayPal valida que el monto no exceda lo capturado.
 *
 * Errores comunes (que devolvemos al caller para que loguee):
 *   - CAPTURE_FULLY_REFUNDED: ya se reembolsó todo
 *   - INVALID_REFUND_AMOUNT: monto > capturado
 *   - PERMISSION_DENIED: credenciales no son del merchant que capturó
 */
export async function refundPaypalCapture(args: {
  configId: string;
  clientId: string;
  clientSecret: string;
  mode: Mode;
  captureId: string;
  /** Si se omite, refund total. */
  amount?: number;
  currency?: string;
  /** Nota interna que el host ve en su dashboard PayPal. */
  noteToPayer?: string;
}): Promise<{
  id: string;
  status: string;
  amount: number;
  currency: string;
}> {
  const token = await getAccessToken(args);

  // PayPal exige amount + currency JUNTOS o ningún body para refund total.
  // Si solo viene amount sin currency, devolvemos error antes de pegarle.
  const body: Record<string, unknown> = {};
  if (args.amount != null) {
    if (!args.currency) {
      throw new Error("refund con amount requiere currency");
    }
    body.amount = {
      value: args.amount.toFixed(2),
      currency_code: args.currency,
    };
  }
  if (args.noteToPayer) {
    body.note_to_payer = args.noteToPayer.slice(0, 255);
  }

  const res = await fetch(
    `${API_URLS[args.mode]}/v2/payments/captures/${encodeURIComponent(args.captureId)}/refund`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // Prefer return=representation para recibir el objeto refund con
        // status, amount, etc en lugar de un resumen minimo.
        Prefer: "return=representation",
      },
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
    },
  );

  if (!res.ok) {
    let payload: { name?: string; message?: string; details?: Array<{ issue?: string; description?: string }> } = {};
    try {
      payload = (await res.json()) as typeof payload;
    } catch {
      /* ignore parse */
    }
    const issue = payload.details?.[0]?.issue ?? payload.name ?? "UNKNOWN";
    const desc =
      payload.details?.[0]?.description ?? payload.message ?? `HTTP ${res.status}`;
    throw new Error(`PayPal refund failed [${issue}]: ${desc}`);
  }

  const json = (await res.json()) as {
    id: string;
    status: string;
    amount?: { value?: string; currency_code?: string };
  };
  return {
    id: json.id,
    status: json.status,
    amount: Number(json.amount?.value ?? 0),
    currency: json.amount?.currency_code ?? args.currency ?? "USD",
  };
}
