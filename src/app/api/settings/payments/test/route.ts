/**
 * POST /api/settings/payments/test
 *
 * El host valida sus credenciales PayPal sin necesidad de crear una
 * orden real. Hace una llamada a /v1/oauth2/token y mapea el error de
 * PayPal a algo útil para el host (en lugar del genérico 401).
 *
 * Body: { provider: 'paypal' }  — usa las credenciales guardadas en BD.
 *
 * Útil para diagnosticar:
 *   - "invalid_client" → claves del entorno equivocado (sandbox vs live).
 *   - "invalid_request" → app deshabilitada o sin feature "Accept payments".
 *   - 5xx → red de PayPal caída.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

const TOKEN_URLS = {
  sandbox: "https://api-m.sandbox.paypal.com/v1/oauth2/token",
  live: "https://api-m.paypal.com/v1/oauth2/token",
} as const;

export async function POST(req: NextRequest) {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user || !tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { provider?: string };
  try {
    body = (await req.json()) as { provider?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const provider = String(body.provider ?? "paypal");
  if (provider !== "paypal") {
    return NextResponse.json({ error: "Provider no soportado" }, { status: 400 });
  }

  const { data } = await supabase
    .from("tenant_payment_configs")
    .select("client_id, client_secret, mode")
    .eq("tenant_id", tenantId)
    .eq("provider", "paypal")
    .maybeSingle();

  const cfg = data as { client_id: string | null; client_secret: string | null; mode: string } | null;
  if (!cfg || !cfg.client_id || !cfg.client_secret) {
    return NextResponse.json(
      { ok: false, error: "Faltan credenciales. Cargá Client ID y Secret y guardá antes de probar." },
      { status: 400 }
    );
  }

  // Trim defensivo — paste puede meter trailing spaces/newlines.
  const clientId = cfg.client_id.trim();
  const clientSecret = cfg.client_secret.trim();
  const mode: "sandbox" | "live" = cfg.mode === "live" ? "live" : "sandbox";

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  let pp: Response;
  try {
    pp = await fetch(TOKEN_URLS[mode], {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "No se pudo conectar con PayPal. Reintentá en unos segundos." },
      { status: 502 }
    );
  }

  if (pp.ok) {
    return NextResponse.json({
      ok: true,
      mode,
      message: `Conexión exitosa con PayPal ${mode === "sandbox" ? "Sandbox" : "Live"}.`,
    });
  }

  // Mapeo de errores comunes a mensajes útiles para el host.
  let errBody: { error?: string; error_description?: string } = {};
  try {
    errBody = (await pp.json()) as { error?: string; error_description?: string };
  } catch {
    /* ignore */
  }

  const errCode = errBody.error ?? "";
  const errDesc = errBody.error_description ?? "";

  let humanError: string;
  if (errCode === "invalid_client") {
    humanError =
      `PayPal rechazó las credenciales (modo: ${mode}). Causas frecuentes:\n` +
      `· Pegaste claves de Live pero el modo seleccionado es Sandbox (o viceversa). Las claves son distintas en developer.paypal.com → tabs "Sandbox" vs "Live".\n` +
      `· El Client Secret tiene espacios al inicio/final. Volvé a copiarlo asegurándote de seleccionar solo el código.\n` +
      `· La app fue eliminada o deshabilitada en PayPal Developer.`;
  } else if (errCode === "invalid_request") {
    humanError =
      `La app de PayPal no está habilitada para Checkout (server-to-server). En developer.paypal.com, abrí tu app → "Features" → marcá "Accept payments".`;
  } else if (pp.status >= 500) {
    humanError = "PayPal está respondiendo con error (5xx). Reintentá en unos minutos.";
  } else {
    humanError = `PayPal respondió ${pp.status}: ${errCode} ${errDesc}`.trim();
  }

  return NextResponse.json(
    { ok: false, error: humanError, paypalCode: errCode, paypalStatus: pp.status },
    { status: 200 } // 200 con ok:false — el host quiere ver el detalle, no un 4xx genérico
  );
}
