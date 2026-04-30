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
}): Promise<{ id: string; status: string; payerEmail: string | null; amount: number; currency: string }> {
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
        captures?: Array<{ amount?: { value?: string; currency_code?: string } }>;
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
  };
}
