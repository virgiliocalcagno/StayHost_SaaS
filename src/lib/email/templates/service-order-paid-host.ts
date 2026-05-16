/**
 * Email al HOST cuando un huésped paga una orden de Ventas Extras.
 *
 * Datos críticos en el cuerpo:
 *   - Total + items con cantidades y fechas (qué servicios pidió)
 *   - Datos del huésped (nombre, teléfono → wa.me link)
 *   - Link al dashboard para gestionar la orden
 *
 * Tono ejecutivo: el host debe poder decidir en 10 segundos si llamar al
 * vendor y avisarle. Si hay teléfono del huésped, le incluimos un link
 * pre-armado de WhatsApp para confirmar.
 */

import { formatMoney } from "@/lib/money/format";

type Item = {
  name: string;
  quantity: number;
  pricingModel: string;
  unitPrice: number;
  lineTotal: number;
  serviceDate: string | null;
};

type ServiceOrderPaidHostEmailData = {
  hostName: string;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  total: number;
  currency: string;
  paymentId: string;
  items: Item[];
  notes: string | null;
  dashboardUrl: string;
};

const SUFFIX: Record<string, string> = {
  fixed: "",
  per_person: "personas",
  per_unit: "unidades",
  per_kg: "kg",
  per_night: "noches",
};

export function renderServiceOrderPaidHostEmail(
  d: ServiceOrderPaidHostEmailData,
): { subject: string; html: string } {
  const subject = `🛍️ Nueva venta de extras · ${escapeHtml(d.guestName)} · ${formatMoney(d.total, d.currency)}`;

  const waLink = d.guestPhone
    ? `https://wa.me/${d.guestPhone.replace(/\D/g, "")}?text=${encodeURIComponent(
        `Hola ${d.guestName}! Confirmamos tu reserva de servicios extras. Te coordino los detalles…`,
      )}`
    : null;

  const itemsHtml = d.items
    .map((it) => {
      const suffix = SUFFIX[it.pricingModel] ?? "";
      const qtyLabel = it.pricingModel === "fixed"
        ? (it.quantity > 1 ? ` × ${it.quantity}` : "")
        : ` × ${it.quantity}${suffix ? ` ${suffix}` : ""}`;
      const dateLabel = it.serviceDate ? ` · ${escapeHtml(it.serviceDate)}` : "";
      return `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0">
          <p style="margin:0;font-size:14px;font-weight:600">${escapeHtml(it.name)}${escapeHtml(qtyLabel)}</p>
          <p style="margin:2px 0 0;font-size:11px;color:#64748b">${dateLabel}</p>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;text-align:right;white-space:nowrap">
          <p style="margin:0;font-size:14px;font-weight:700">${escapeHtml(formatMoney(it.lineTotal, d.currency))}</p>
        </td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;border:1px solid #e2e8f0;overflow:hidden">

        <tr><td style="background:linear-gradient(135deg,#d97706,#f59e0b);padding:28px 32px;text-align:center;color:#ffffff">
          <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;opacity:0.9">🛍️ Venta confirmada</p>
          <p style="margin:8px 0 0;font-size:36px;font-weight:800">${escapeHtml(formatMoney(d.total, d.currency))}</p>
          <p style="margin:8px 0 0;font-size:13px;opacity:0.9">Pago capturado · ${escapeHtml(d.paymentId)}</p>
        </td></tr>

        <tr><td style="padding:24px 32px">
          <p style="margin:0;font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase">Huésped</p>
          <p style="margin:6px 0 4px;font-size:18px;font-weight:700">${escapeHtml(d.guestName)}</p>
          ${d.guestPhone ? `<p style="margin:0;font-size:13px;color:#475569">📱 ${escapeHtml(d.guestPhone)}</p>` : ""}
          ${d.guestEmail ? `<p style="margin:0;font-size:13px;color:#475569">✉️ ${escapeHtml(d.guestEmail)}</p>` : ""}
        </td></tr>

        <tr><td style="padding:0 32px 24px">
          <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase">Servicios pedidos</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${itemsHtml}
            <tr>
              <td style="padding:14px 0 0;font-size:14px;font-weight:700">Total</td>
              <td style="padding:14px 0 0;text-align:right;font-size:18px;font-weight:800">${escapeHtml(formatMoney(d.total, d.currency))}</td>
            </tr>
          </table>
        </td></tr>

        ${d.notes ? `<tr><td style="padding:0 32px 24px">
          <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:8px">
            <p style="margin:0;font-size:10px;font-weight:700;color:#78350f;letter-spacing:1px;text-transform:uppercase">Nota del huésped</p>
            <p style="margin:6px 0 0;font-size:13px;color:#1e293b">${escapeHtml(d.notes)}</p>
          </div>
        </td></tr>` : ""}

        <tr><td style="padding:0 32px 28px;text-align:center">
          ${waLink ? `<a href="${waLink}" style="display:inline-block;background:#10b981;color:#ffffff;padding:12px 24px;border-radius:24px;text-decoration:none;font-weight:700;font-size:14px;margin:0 4px 8px">💬 WhatsApp al huésped</a>` : ""}
          <a href="${escapeHtml(d.dashboardUrl)}" style="display:inline-block;background:#1e293b;color:#ffffff;padding:12px 24px;border-radius:24px;text-decoration:none;font-weight:700;font-size:14px;margin:0 4px 8px">Ver en dashboard</a>
        </td></tr>

        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;text-align:center">
          <p style="margin:0;font-size:11px;color:#94a3b8">StayHost · Notificación automática</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
