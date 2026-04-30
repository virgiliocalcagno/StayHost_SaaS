/**
 * /api/settings/payments — el host configura sus credenciales de PayPal
 * (futuro: Stripe, MercadoPago, etc.).
 *
 * GET → devuelve configs del tenant con el secret ENMASCARADO. Nunca
 *       envía el secret real al frontend.
 * PUT → upsert config para un provider. Si client_secret viene vacío en
 *       el body, mantiene el guardado (UX: el host edita el client_id sin
 *       tener que re-pegar el secret).
 *
 * Solo el host autenticado puede leer/escribir sus configs (RLS).
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

const ALLOWED_PROVIDERS = ["paypal"] as const;
type Provider = (typeof ALLOWED_PROVIDERS)[number];

function maskSecret(s: string | null): string | null {
  if (!s) return null;
  if (s.length <= 4) return "••••";
  return `••••••••${s.slice(-4)}`;
}

export async function GET() {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user || !tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("tenant_payment_configs")
    .select("id, provider, client_id, client_secret, mode, enabled, processing_fee_percent, updated_at")
    .eq("tenant_id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const configs = ((data ?? []) as Array<{
    id: string;
    provider: string;
    client_id: string | null;
    client_secret: string | null;
    mode: string;
    enabled: boolean;
    processing_fee_percent: number | string | null;
    updated_at: string;
  }>).map((c) => ({
    id: c.id,
    provider: c.provider,
    clientId: c.client_id,
    clientSecretMasked: maskSecret(c.client_secret),
    mode: c.mode,
    enabled: c.enabled,
    processingFeePercent: Number(c.processing_fee_percent ?? 0),
    updatedAt: c.updated_at,
  }));

  return NextResponse.json({ configs });
}

export async function PUT(req: NextRequest) {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user || !tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const provider = String(body.provider ?? "");
  if (!ALLOWED_PROVIDERS.includes(provider as Provider)) {
    return NextResponse.json({ error: "Provider no soportado" }, { status: 400 });
  }

  const clientId = body.clientId == null ? null : String(body.clientId).trim() || null;
  const newSecret = typeof body.clientSecret === "string" ? body.clientSecret.trim() : "";
  const mode = String(body.mode ?? "sandbox");
  if (!["sandbox", "live"].includes(mode)) {
    return NextResponse.json({ error: "Mode debe ser sandbox o live" }, { status: 400 });
  }
  const enabled = Boolean(body.enabled);

  // Comisión de procesamiento (0–20%). Si no viene en el body, queda como
  // está en BD (no la pisamos con 0).
  const feeRaw = body.processingFeePercent;
  let processingFeePercent: number | undefined;
  if (feeRaw !== undefined && feeRaw !== null && feeRaw !== "") {
    processingFeePercent = Number(feeRaw);
    if (Number.isNaN(processingFeePercent) || processingFeePercent < 0 || processingFeePercent > 20) {
      return NextResponse.json(
        { error: "La comisión de procesamiento debe estar entre 0 y 20%" },
        { status: 400 }
      );
    }
  }

  if (clientId && clientId.length > 200) {
    return NextResponse.json({ error: "client_id demasiado largo" }, { status: 400 });
  }
  if (newSecret && newSecret.length > 500) {
    return NextResponse.json({ error: "client_secret demasiado largo" }, { status: 400 });
  }
  // Validacion semantica minima: si lo van a habilitar, debe tener al menos
  // client_id seteado (el secret puede venir vacio si ya estaba guardado).
  if (enabled && !clientId) {
    return NextResponse.json(
      { error: "Para habilitar pagos, configurá client_id y client_secret" },
      { status: 400 }
    );
  }

  // Si el host mando newSecret vacio Y la fila ya existe, mantenemos el
  // anterior. Para eso hacemos un fetch primero.
  const { data: existing } = await supabase
    .from("tenant_payment_configs")
    .select("id, client_secret")
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .maybeSingle<{ id: string; client_secret: string | null }>();

  const finalSecret = newSecret
    ? newSecret
    : existing?.client_secret ?? null;

  if (enabled && !finalSecret) {
    return NextResponse.json(
      { error: "Para habilitar pagos, ingresá tu client_secret" },
      { status: 400 }
    );
  }

  if (existing) {
    const updatePayload: Record<string, unknown> = {
      client_id: clientId,
      client_secret: finalSecret,
      mode,
      enabled,
      updated_at: new Date().toISOString(),
    };
    if (processingFeePercent !== undefined) {
      updatePayload.processing_fee_percent = processingFeePercent;
    }
    const { error: upErr } = await supabase
      .from("tenant_payment_configs")
      .update(updatePayload as never)
      .eq("id", existing.id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  } else {
    const insertPayload: Record<string, unknown> = {
      tenant_id: tenantId,
      provider,
      client_id: clientId,
      client_secret: finalSecret,
      mode,
      enabled,
    };
    if (processingFeePercent !== undefined) {
      insertPayload.processing_fee_percent = processingFeePercent;
    }
    const { error: insErr } = await supabase
      .from("tenant_payment_configs")
      .insert(insertPayload as never);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
