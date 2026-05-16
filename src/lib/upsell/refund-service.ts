/**
 * Helper interno reusable para refundear una service_order via PayPal.
 *
 * Usado por:
 *   - POST /api/service-orders/[id]/refund (host manual)
 *   - POST /api/guest/orders/[id]/cancel (cliente cancela pre-cutoff o aprobada)
 *   - POST /api/cron/cancellation-sla (auto-aprobación SLA)
 *
 * NO valida auth — eso lo hace cada caller con sus reglas.
 *
 * Devuelve resultado estructurado con detalle del refund (ID PayPal,
 * monto, status) o el motivo del error sanitizado para mostrar al usuario.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  refundPaypalCapture,
  getPaypalOrderCaptureId,
} from "@/lib/paypal/client";

export type ExecuteRefundInput = {
  orderId: string;
  /** Nota visible al huésped en el email de PayPal. Max 255. */
  noteToPayer?: string | null;
  /** Para audit en refund_note de BD. */
  internalNote?: string | null;
};

export type ExecuteRefundResult =
  | {
      ok: true;
      refundPaymentId: string;
      amount: number;
      currency: string;
      status: string;
      alreadyRefunded?: boolean;
    }
  | {
      ok: false;
      code: "not_found" | "not_paypal" | "invalid_state" | "no_capture" | "paypal_error" | "db_error";
      message: string;
      /** En caso de db_error con refund procesado, este flag avisa al caller. */
      paypalSucceeded?: boolean;
      refundPaymentId?: string;
    };

const SAFE_PAYPAL_ERRORS: Array<[fragment: string, msg: string]> = [
  ["CAPTURE_FULLY_REFUNDED", "PayPal reporta este capture ya reembolsado."],
  ["PERMISSION_DENIED", "PayPal denegó el reembolso (sin permiso sobre este capture)."],
  ["INVALID_REFUND_AMOUNT", "Monto del reembolso inválido."],
  ["REFUND_TIME_LIMIT_EXCEEDED", "Pasó el plazo de PayPal para reembolsos automáticos (~180 días)."],
  ["TRANSACTION_REFUSED", "PayPal rechazó la operación."],
  ["INSTRUMENT_DECLINED", "PayPal rechazó la operación."],
  ["invalid_client", "Credenciales PayPal del host inválidas."],
];

function sanitizePaypalError(msg: string): string {
  for (const [frag, safe] of SAFE_PAYPAL_ERRORS) {
    if (msg.includes(frag)) return safe;
  }
  return "Error procesando el reembolso en PayPal.";
}

export async function executeRefundForOrder(
  input: ExecuteRefundInput,
): Promise<ExecuteRefundResult> {
  // 1) Lookup order
  const { data: orderRow } = await supabaseAdmin
    .from("service_orders")
    .select(
      "id, tenant_id, status, total_amount, currency, payment_provider, payment_id, payment_capture_id, refunded_at, refund_payment_id",
    )
    .eq("id", input.orderId)
    .maybeSingle();

  if (!orderRow) {
    return { ok: false, code: "not_found", message: "Orden no encontrada." };
  }
  const order = orderRow as {
    id: string;
    tenant_id: string;
    status: string;
    total_amount: number | string;
    currency: string;
    payment_provider: string | null;
    payment_id: string | null;
    payment_capture_id: string | null;
    refunded_at: string | null;
    refund_payment_id: string | null;
  };

  // 2) Idempotencia
  if (order.refunded_at && order.refund_payment_id) {
    return {
      ok: true,
      alreadyRefunded: true,
      refundPaymentId: order.refund_payment_id,
      amount: Number(order.total_amount),
      currency: order.currency,
      status: "COMPLETED",
    };
  }

  // 3) Validaciones
  if (order.payment_provider !== "paypal") {
    return {
      ok: false,
      code: "not_paypal",
      message: "Esta orden no fue pagada con PayPal. Coordiná manualmente.",
    };
  }
  if (order.status !== "paid") {
    return {
      ok: false,
      code: "invalid_state",
      message: `Solo refundeables las órdenes pagadas (estado actual: ${order.status}).`,
    };
  }
  if (!order.payment_id) {
    return {
      ok: false,
      code: "invalid_state",
      message: "Falta payment_id en la orden — no se puede ubicar el pago.",
    };
  }

  // 4) Credenciales PayPal del host
  const { data: cfgRow } = await supabaseAdmin
    .from("tenant_payment_configs")
    .select("id, client_id, client_secret, mode")
    .eq("tenant_id", order.tenant_id)
    .eq("provider", "paypal")
    .maybeSingle();
  const config = cfgRow as {
    id: string;
    client_id: string | null;
    client_secret: string | null;
    mode: string;
  } | null;
  if (!config || !config.client_id || !config.client_secret) {
    return {
      ok: false,
      code: "no_capture",
      message: "PayPal del host no configurado. Revisá Configuración → Pagos.",
    };
  }
  const mode: "sandbox" | "live" = config.mode === "live" ? "live" : "sandbox";

  // 5) Resolver capture_id (con fallback a lookup PayPal)
  let captureId = order.payment_capture_id;
  if (!captureId) {
    try {
      captureId = await getPaypalOrderCaptureId({
        configId: config.id,
        clientId: config.client_id,
        clientSecret: config.client_secret,
        mode,
        orderId: order.payment_id,
      });
    } catch (err) {
      console.error("[refund-service] getCaptureId failed:", err);
      return {
        ok: false,
        code: "no_capture",
        message: "No se pudo ubicar el capture en PayPal.",
      };
    }
    if (!captureId) {
      return {
        ok: false,
        code: "no_capture",
        message: "PayPal no devolvió capture para esta orden.",
      };
    }
  }

  // 6) Disparar refund
  const totalAmount = Number(order.total_amount);
  let refund: { id: string; status: string; amount: number; currency: string };
  try {
    refund = await refundPaypalCapture({
      configId: config.id,
      clientId: config.client_id,
      clientSecret: config.client_secret,
      mode,
      captureId,
      amount: totalAmount,
      currency: order.currency,
      noteToPayer: input.noteToPayer ?? undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[refund-service] PayPal refund failed:", msg);

    // CAPTURE_FULLY_REFUNDED: sincronizamos estado local.
    if (msg.includes("CAPTURE_FULLY_REFUNDED")) {
      await supabaseAdmin
        .from("service_orders")
        .update({
          status: "refunded",
          refunded_at: new Date().toISOString(),
          refund_amount: totalAmount,
          refund_note: input.internalNote ?? null,
        } as never)
        .eq("id", order.id)
        .is("refunded_at", null);
      return {
        ok: true,
        alreadyRefunded: true,
        refundPaymentId: "",
        amount: totalAmount,
        currency: order.currency,
        status: "COMPLETED",
      };
    }
    return {
      ok: false,
      code: "paypal_error",
      message: sanitizePaypalError(msg),
    };
  }

  const isAccepted = refund.status === "COMPLETED" || refund.status === "PENDING";
  if (!isAccepted) {
    return {
      ok: false,
      code: "paypal_error",
      message: `Refund no aceptado: ${refund.status}`,
    };
  }

  // 7) UPDATE BD con guard de concurrencia
  const { error: upErr } = await supabaseAdmin
    .from("service_orders")
    .update({
      status: "refunded",
      refunded_at: new Date().toISOString(),
      refund_amount: refund.amount || totalAmount,
      refund_payment_id: refund.id,
      refund_note: input.internalNote ?? null,
    } as never)
    .eq("id", order.id)
    .eq("tenant_id", order.tenant_id)
    .is("refunded_at", null);

  if (upErr) {
    console.error(
      `[refund-service] CRITICAL: refund procesado en PayPal (${refund.id}) pero UPDATE BD falló:`,
      upErr,
    );
    return {
      ok: false,
      code: "db_error",
      message: `Refund procesado en PayPal pero falló sincronización local. Refund ID: ${refund.id}.`,
      paypalSucceeded: true,
      refundPaymentId: refund.id,
    };
  }

  return {
    ok: true,
    refundPaymentId: refund.id,
    amount: refund.amount,
    currency: refund.currency,
    status: refund.status,
  };
}
