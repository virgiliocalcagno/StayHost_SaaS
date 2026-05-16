/**
 * POST /api/public/redeem/[token]/action
 *
 * Endpoint público (sin auth de sesión) que el vendor invoca desde el
 * portal /v/[token] para cambiar el estado de la orden:
 *
 *   action = 'confirm' → vendor confirma que va a entregar (awaiting → confirmed)
 *   action = 'decline' → vendor no puede atenderla (awaiting → declined)
 *   action = 'deliver' → vendor marca entregada presencial (confirmed → delivered)
 *
 * Auth model — el endpoint exige credenciales adicionales según el caso:
 *
 *   confirm/decline:
 *     - actionToken (en el body, viene del email del vendor)
 *
 *   deliver:
 *     - actionToken + pin del huésped
 *     - El PIN prueba presencia física: vendor + huésped en el mismo lugar
 *       al momento de la entrega. El huésped lo dicta o muestra el QR.
 *
 * Si decline → además dispara email al host con resumen para que reasigne.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizePin, isValidPinFormat } from "@/lib/upsell/redemption";
import { sendEmail } from "@/lib/email/send";

type ActionBody = {
  action?: string;
  actionToken?: string;
  pin?: string;
  declineReason?: string;
};

const VALID_ACTIONS = new Set(["confirm", "decline", "deliver"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const normalizedToken = token.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(normalizedToken)) {
    return NextResponse.json({ error: "Token inválido" }, { status: 400 });
  }

  let body: ActionBody = {};
  try {
    body = (await req.json()) as ActionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = String(body.action ?? "").trim();
  if (!VALID_ACTIONS.has(action)) {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }
  const actionToken = String(body.actionToken ?? "").trim();
  if (!actionToken) {
    return NextResponse.json({ error: "actionToken requerido" }, { status: 401 });
  }

  // Lookup de la orden por redemption_token. Validamos action_token después.
  const { data: orderRow } = await supabaseAdmin
    .from("service_orders")
    .select(
      "id, tenant_id, status, vendor_status, vendor_action_token, redemption_pin, guest_name, total_amount, currency, paid_at",
    )
    .eq("redemption_token", normalizedToken)
    .maybeSingle();

  if (!orderRow) {
    return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  }
  const order = orderRow as {
    id: string;
    tenant_id: string;
    status: string;
    vendor_status: string;
    vendor_action_token: string | null;
    redemption_pin: string | null;
    guest_name: string;
    total_amount: string | number;
    currency: string;
    paid_at: string | null;
  };

  // El portal solo aplica a órdenes pagadas. Una orden pending no tiene
  // action_token todavía (se genera al pasar a paid).
  if (order.status !== "paid" && order.status !== "completed") {
    return NextResponse.json(
      { error: "La orden no está disponible para gestión" },
      { status: 422 },
    );
  }

  // Verificar el action_token con comparación constante (mitigación de
  // timing attacks). Si no matchea, devolvemos 401 sin pistas.
  if (
    !order.vendor_action_token ||
    !constantTimeEqual(actionToken, order.vendor_action_token)
  ) {
    return NextResponse.json(
      { error: "Token de acción inválido. Abrí el link desde el email." },
      { status: 401 },
    );
  }

  // Transition validation por action.
  const now = new Date().toISOString();
  let patch: Record<string, unknown> = {};
  let declineReason: string | null = null;

  if (action === "confirm") {
    if (order.vendor_status !== "awaiting") {
      return NextResponse.json(
        { error: `No se puede confirmar desde estado "${order.vendor_status}"` },
        { status: 422 },
      );
    }
    patch = {
      vendor_status: "confirmed",
      vendor_confirmed_at: now,
    };
  } else if (action === "decline") {
    if (order.vendor_status !== "awaiting" && order.vendor_status !== "confirmed") {
      return NextResponse.json(
        { error: `No se puede declinar desde estado "${order.vendor_status}"` },
        { status: 422 },
      );
    }
    declineReason = typeof body.declineReason === "string"
      ? body.declineReason.trim().slice(0, 500)
      : null;
    patch = {
      vendor_status: "declined",
      vendor_declined_at: now,
      vendor_decline_reason: declineReason,
    };
  } else if (action === "deliver") {
    // Solo desde 'confirmed' o 'awaiting' (skip confirm si urge).
    // No permitimos deliver desde declined.
    if (order.vendor_status !== "confirmed" && order.vendor_status !== "awaiting") {
      return NextResponse.json(
        {
          error:
            order.vendor_status === "delivered"
              ? "Esta orden ya fue marcada como entregada."
              : `No se puede entregar desde estado "${order.vendor_status}"`,
        },
        { status: 422 },
      );
    }
    // PIN del huésped es OBLIGATORIO para deliver. Es la prueba de
    // presencia física que evita que el vendor marque entregadas sin
    // haber visto al huésped (fraude operacional).
    const rawPin = typeof body.pin === "string" ? normalizePin(body.pin) : "";
    if (!rawPin) {
      return NextResponse.json(
        { error: "Pedile al huésped que te dicte el PIN o muestre el QR." },
        { status: 400 },
      );
    }
    if (!isValidPinFormat(rawPin)) {
      return NextResponse.json(
        { error: "PIN inválido. Son 6 caracteres del código del huésped." },
        { status: 400 },
      );
    }
    if (!order.redemption_pin || rawPin !== order.redemption_pin) {
      return NextResponse.json(
        { error: "PIN incorrecto. Verificá con el huésped." },
        { status: 401 },
      );
    }
    patch = {
      vendor_status: "delivered",
      redeemed_at: now,
    };
  }

  // UPDATE con guard de estado para concurrencia (dos clicks paralelos).
  const { error: upErr } = await supabaseAdmin
    .from("service_orders")
    .update(patch as never)
    .eq("id", order.id)
    .eq("vendor_action_token", actionToken)
    .eq("vendor_status", order.vendor_status); // CAS — falla si otro request cambió el status

  if (upErr) {
    return NextResponse.json(
      { error: "No se pudo actualizar la orden. Probá de nuevo." },
      { status: 500 },
    );
  }

  // Si decline → email al host para que reasigne. Best-effort, no bloqueante.
  if (action === "decline") {
    try {
      const { data: tenant } = await supabaseAdmin
        .from("tenants")
        .select("name, company, contact_email, email")
        .eq("id", order.tenant_id)
        .maybeSingle();
      const tenantRow = tenant as {
        name: string | null; company: string | null;
        contact_email: string | null; email: string;
      } | null;
      const hostEmail = tenantRow?.contact_email ?? tenantRow?.email ?? null;
      const hostName = tenantRow?.company || tenantRow?.name || "Host";
      if (hostEmail) {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
        const reasonHtml = declineReason
          ? `<p style="margin:8px 0 0;font-size:14px;color:#475569;font-style:italic">"${escapeHtml(declineReason)}"</p>`
          : "";
        await sendEmail({
          to: hostEmail,
          subject: `⚠️ Vendor declinó la orden de ${order.guest_name}`,
          fromName: "StayHost",
          html: `<!doctype html><html><body style="font-family:-apple-system,sans-serif;background:#f1f5f9;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:28px">
  <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:1.5px;color:#dc2626;text-transform:uppercase">⚠️ Acción requerida</p>
  <h1 style="margin:8px 0 16px;font-size:22px;color:#1e293b">El vendor declinó una reserva pagada</h1>
  <p style="margin:0;font-size:14px;color:#475569;line-height:1.6">
    Hola <strong>${escapeHtml(hostName)}</strong>, el vendor de los servicios de <strong>${escapeHtml(order.guest_name)}</strong> rechazó la orden. El huésped ya pagó — tenés que reasignar a otro proveedor o reembolsar.
  </p>
  ${reasonHtml}
  <a href="${baseUrl}/dashboard?panel=upsells" style="display:block;background:#1e293b;color:#fff;padding:14px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;text-align:center;margin-top:20px">Abrir panel de Pedidos →</a>
</div></body></html>`,
        });
      }
    } catch (e) {
      console.error("[redeem/action] decline email failed:", e);
    }
  }

  return NextResponse.json({
    ok: true,
    vendorStatus: patch.vendor_status,
    declineReason: declineReason ?? undefined,
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
