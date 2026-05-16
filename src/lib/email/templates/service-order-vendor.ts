/**
 * Email al VENDOR cuando una orden de Ventas Extras pasa a "paid".
 *
 * Diferente del email al host: este email lleva DATOS DEL HUÉSPED
 * (nombre, teléfono opcional, email) porque el vendor necesita
 * coordinar la entrega directo con el huésped. Esto NO viola la regla
 * de privacidad — el vendor es contraparte comercial, no staff.
 *
 * Lleva un link único `https://stayhost.../v/{redemption_token}?k={action_token}`
 * que abre el portal del vendor con permisos de acción (confirmar/declinar/
 * entregar). El `k=...` es lo que prueba que es el vendor real, no
 * cualquiera con el QR del huésped.
 */

import { formatMoney } from "@/lib/money/format";

type Item = {
  name: string;
  quantity: number;
  pricingModel: string;
  lineTotal: number;
  serviceDate: string | null;
  serviceTime: string | null;
  pickupLocation: string | null;
  flightNumber: string | null;
  extraNotes: string | null;
};

type VendorEmailData = {
  vendorName: string;
  hostName: string;
  orderId: string;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  total: number;
  currency: string;
  items: Item[];
  /** URL absoluta del portal con redemption_token + action_token */
  manageUrl: string;
};

const SUFFIX: Record<string, string> = {
  fixed: "",
  per_person: "personas",
  per_unit: "unidades",
  per_kg: "kg",
  per_night: "noches",
};

export function renderServiceOrderVendorEmail(
  d: VendorEmailData,
): { subject: string; html: string } {
  // Subject claro y urgente — el vendor abre 100% de los emails con "Nueva
  // reserva" + nombre del huésped en el subject.
  const subject = `🛎 Nueva reserva: ${d.guestName} · ${d.hostName}`;

  const itemsHtml = d.items
    .map((it) => {
      const suffix = SUFFIX[it.pricingModel] ?? "";
      const qtyLabel = it.pricingModel === "fixed"
        ? (it.quantity > 1 ? ` × ${it.quantity}` : "")
        : ` × ${it.quantity}${suffix ? ` ${suffix}` : ""}`;

      const detailRows: string[] = [];
      if (it.serviceDate) detailRows.push(`📅 ${escapeHtml(it.serviceDate)}`);
      if (it.serviceTime) detailRows.push(`🕒 ${escapeHtml(it.serviceTime)}`);
      if (it.pickupLocation) detailRows.push(`📍 ${escapeHtml(it.pickupLocation)}`);
      if (it.flightNumber) detailRows.push(`✈️ ${escapeHtml(it.flightNumber)}`);

      const detailsHtml = detailRows.length > 0
        ? `<p style="margin:6px 0 0;font-size:12px;color:#475569;line-height:1.5">${detailRows.join(" · ")}</p>`
        : "";

      const notesHtml = it.extraNotes
        ? `<p style="margin:6px 0 0;font-size:12px;color:#92400e;background:#fef3c7;padding:8px;border-radius:6px;border-left:3px solid #f59e0b">💬 ${escapeHtml(it.extraNotes)}</p>`
        : "";

      return `<tr>
        <td style="padding:14px 0;border-bottom:1px solid #e2e8f0">
          <p style="margin:0;font-size:15px;font-weight:600">${escapeHtml(it.name)}${escapeHtml(qtyLabel)}</p>
          ${detailsHtml}
          ${notesHtml}
        </td>
        <td style="padding:14px 0;border-bottom:1px solid #e2e8f0;text-align:right;white-space:nowrap;vertical-align:top">
          <p style="margin:0;font-size:14px;font-weight:700">${escapeHtml(formatMoney(it.lineTotal, d.currency))}</p>
        </td>
      </tr>`;
    })
    .join("");

  // Contacto del huésped: opcional, solo si lo dejó al pagar.
  const contactRows: string[] = [];
  if (d.guestPhone) {
    const waLink = `https://wa.me/${d.guestPhone.replace(/\D/g, "")}`;
    contactRows.push(
      `<a href="${waLink}" style="display:inline-block;background:#10b981;color:#ffffff;padding:8px 16px;border-radius:20px;text-decoration:none;font-weight:600;font-size:12px;margin:4px 6px 4px 0">💬 ${escapeHtml(d.guestPhone)}</a>`,
    );
  }
  if (d.guestEmail) {
    contactRows.push(
      `<a href="mailto:${escapeHtml(d.guestEmail)}" style="display:inline-block;background:#1e293b;color:#ffffff;padding:8px 16px;border-radius:20px;text-decoration:none;font-weight:600;font-size:12px;margin:4px 6px 4px 0">✉️ Email</a>`,
    );
  }
  const contactHtml = contactRows.length > 0
    ? `<div style="margin-top:8px">${contactRows.join("")}</div>`
    : `<p style="margin:0;font-size:12px;color:#94a3b8;font-style:italic">El huésped no dejó contacto directo. Confirmá la orden vía el portal y el host coordinará.</p>`;

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

        <tr><td style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:32px;text-align:center;color:#ffffff">
          <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;opacity:0.9">🛎 Nueva reserva pagada</p>
          <p style="margin:12px 0 0;font-size:24px;font-weight:800">${escapeHtml(d.guestName)}</p>
          <p style="margin:6px 0 0;font-size:13px;opacity:0.9">vía ${escapeHtml(d.hostName)}</p>
          <p style="margin:14px 0 0;font-size:28px;font-weight:800">${escapeHtml(formatMoney(d.total, d.currency))}</p>
        </td></tr>

        <tr><td style="padding:28px 32px 8px">
          <p style="margin:0 0 12px;font-size:15px">Hola <strong>${escapeHtml(d.vendorName)}</strong>,</p>
          <p style="margin:0;font-size:14px;color:#475569;line-height:1.6">
            Te tocó una reserva nueva. Revisá los detalles abajo y confirmá si podés atenderla.
          </p>
        </td></tr>

        <tr><td style="padding:8px 32px 16px">
          <a href="${escapeHtml(d.manageUrl)}" style="display:block;background:#1e293b;color:#ffffff;padding:14px;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px;text-align:center;box-shadow:0 4px 12px rgba(30,41,59,0.2)">
            Abrir gestión de la orden →
          </a>
          <p style="margin:8px 0 0;font-size:11px;color:#94a3b8;text-align:center">Confirmar, declinar o marcar entregada desde el portal</p>
        </td></tr>

        <tr><td style="padding:0 32px 24px">
          <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase">Servicios a entregar</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${itemsHtml}
            <tr>
              <td style="padding:14px 0 0;font-size:13px;font-weight:700">Total cobrado al huésped</td>
              <td style="padding:14px 0 0;text-align:right;font-size:16px;font-weight:800">${escapeHtml(formatMoney(d.total, d.currency))}</td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 32px 24px">
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase">Contacto del huésped</p>
          <div style="background:#f8fafc;border-radius:12px;padding:14px">
            <p style="margin:0;font-size:14px;font-weight:600">${escapeHtml(d.guestName)}</p>
            ${contactHtml}
          </div>
        </td></tr>

        <tr><td style="background:#fef3c7;border-top:1px solid #f59e0b;padding:14px 32px">
          <p style="margin:0;font-size:11px;color:#92400e;line-height:1.5">
            <strong>Importante:</strong> al entregar el servicio, pedile al huésped que te muestre su <strong>QR</strong> o te dicte el <strong>PIN de 6 dígitos</strong>. Lo necesitás para marcar la orden como entregada en el portal.
          </p>
        </td></tr>

        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;text-align:center">
          <p style="margin:0;font-size:11px;color:#94a3b8">Reserva ID: <code style="font-family:Menlo,Monaco,monospace;font-size:10px">${escapeHtml(d.orderId.slice(0, 8))}</code> · vía StayHost</p>
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
