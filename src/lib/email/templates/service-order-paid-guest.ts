/**
 * Email al HUÉSPED cuando completa el pago de una orden de Ventas Extras.
 *
 * Tono cálido y útil: el huésped acaba de gastar dinero, queremos que se
 * sienta tranquilo. Incluye:
 *   - Resumen de items con fechas
 *   - Contacto del host (whatsapp/email) para coordinar
 *   - Mensaje claro de "el host se va a comunicar"
 */

import { formatMoney } from "@/lib/money/format";

type Item = {
  name: string;
  quantity: number;
  pricingModel: string;
  lineTotal: number;
  serviceDate: string | null;
};

type GuestPaidEmailData = {
  guestName: string;
  hostName: string;
  hostWhatsapp: string | null;
  hostEmail: string | null;
  total: number;
  currency: string;
  paymentId: string;
  items: Item[];
  // Sprint 6 — credenciales de redención. El PIN va en el cuerpo del email
  // (texto plano grande), y orderUrl apunta a la página del huésped donde
  // ve el QR + estado en vivo de la orden.
  redemptionPin: string | null;
  orderUrl: string | null;
};

const SUFFIX: Record<string, string> = {
  fixed: "",
  per_person: "personas",
  per_unit: "unidades",
  per_kg: "kg",
  per_night: "noches",
};

export function renderServiceOrderPaidGuestEmail(
  d: GuestPaidEmailData,
): { subject: string; html: string } {
  const subject = `✅ Pago confirmado · ${d.hostName}`;

  const waLink = d.hostWhatsapp
    ? `https://wa.me/${d.hostWhatsapp.replace(/\D/g, "")}`
    : null;

  const itemsHtml = d.items
    .map((it) => {
      const suffix = SUFFIX[it.pricingModel] ?? "";
      const qtyLabel = it.pricingModel === "fixed"
        ? (it.quantity > 1 ? ` × ${it.quantity}` : "")
        : ` × ${it.quantity}${suffix ? ` ${suffix}` : ""}`;
      const dateLabel = it.serviceDate
        ? `<p style="margin:2px 0 0;font-size:11px;color:#64748b">📅 ${escapeHtml(it.serviceDate)}</p>`
        : "";
      return `<tr>
        <td style="padding:12px 0;border-bottom:1px solid #e2e8f0">
          <p style="margin:0;font-size:14px;font-weight:600">${escapeHtml(it.name)}${escapeHtml(qtyLabel)}</p>
          ${dateLabel}
        </td>
        <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;text-align:right;white-space:nowrap;vertical-align:top">
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

        <tr><td style="background:linear-gradient(135deg,#059669,#10b981);padding:32px;text-align:center;color:#ffffff">
          <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;opacity:0.9">✅ Pago confirmado</p>
          <p style="margin:12px 0 0;font-size:28px;font-weight:800">${escapeHtml(d.hostName)}</p>
          <p style="margin:8px 0 0;font-size:32px;font-weight:800">${escapeHtml(formatMoney(d.total, d.currency))}</p>
        </td></tr>

        <tr><td style="padding:28px 32px 16px">
          <p style="margin:0 0 16px;font-size:16px">¡Hola <strong>${escapeHtml(d.guestName)}</strong>!</p>
          <p style="margin:0;font-size:14px;color:#475569;line-height:1.6">
            Recibimos tu pago. ${escapeHtml(d.hostName)} se va a comunicar con vos para coordinar los detalles del servicio.
          </p>
        </td></tr>

        ${d.redemptionPin ? `<tr><td style="padding:0 32px 24px">
          <div style="background:#fef3c7;border:2px dashed #f59e0b;border-radius:14px;padding:20px;text-align:center">
            <p style="margin:0;font-size:11px;font-weight:700;color:#92400e;letter-spacing:1.5px;text-transform:uppercase">🎟 Tu pase de entrega</p>
            <p style="margin:10px 0 6px;font-size:36px;font-weight:800;font-family:Menlo,Monaco,monospace;letter-spacing:8px;color:#1e293b">${escapeHtml(d.redemptionPin)}</p>
            <p style="margin:0;font-size:12px;color:#78716c">Mostrale este código (o el QR) al proveedor al llegar.</p>
            ${d.orderUrl ? `<a href="${escapeHtml(d.orderUrl)}" style="display:inline-block;margin-top:14px;background:#1e293b;color:#ffffff;padding:10px 22px;border-radius:24px;text-decoration:none;font-weight:700;font-size:13px">Ver mi QR ↗</a>` : ""}
          </div>
        </td></tr>` : ""}

        <tr><td style="padding:0 32px 24px">
          <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase">Tu pedido</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${itemsHtml}
            <tr>
              <td style="padding:14px 0 0;font-size:14px;font-weight:700">Total pagado</td>
              <td style="padding:14px 0 0;text-align:right;font-size:18px;font-weight:800">${escapeHtml(formatMoney(d.total, d.currency))}</td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 32px 24px">
          <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase">Contactá al host</p>
          <div style="background:#f8fafc;border-radius:12px;padding:16px">
            ${waLink ? `<a href="${waLink}" style="display:inline-block;background:#10b981;color:#ffffff;padding:10px 20px;border-radius:24px;text-decoration:none;font-weight:700;font-size:13px;margin:0 8px 8px 0">💬 WhatsApp</a>` : ""}
            ${d.hostEmail ? `<a href="mailto:${escapeHtml(d.hostEmail)}" style="display:inline-block;background:#1e293b;color:#ffffff;padding:10px 20px;border-radius:24px;text-decoration:none;font-weight:700;font-size:13px;margin:0 8px 8px 0">✉️ Email</a>` : ""}
            <p style="margin:8px 0 0;font-size:11px;color:#94a3b8">ID de pago: <code style="font-family:Menlo,Monaco,monospace;font-size:10px">${escapeHtml(d.paymentId)}</code></p>
          </div>
        </td></tr>

        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;text-align:center">
          <p style="margin:0;font-size:11px;color:#94a3b8">Procesado vía StayHost · ¡Buen viaje!</p>
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
