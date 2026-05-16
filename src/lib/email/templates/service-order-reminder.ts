/**
 * Email recordatorio 24h antes del servicio.
 *
 * Dos variantes:
 *   - renderReminderGuestEmail: al huésped con PIN + link al recibo
 *   - renderReminderVendorEmail: al vendor con datos del huésped + link al portal
 *
 * Disparado por /api/cron/service-reminders una vez al día.
 */

import { formatMoney } from "@/lib/money/format";

type ReminderItem = {
  name: string;
  quantity: number;
  pricingModel: string;
  lineTotal: number;
  serviceDate: string | null;
  serviceTime: string | null;
  pickupLocation: string | null;
  flightNumber: string | null;
};

// ─── Recordatorio al huésped ─────────────────────────────────────────────────
type ReminderGuestData = {
  guestName: string;
  hostName: string;
  total: number;
  currency: string;
  items: ReminderItem[];
  redemptionPin: string | null;
  orderUrl: string | null;
};

export function renderReminderGuestEmail(d: ReminderGuestData): {
  subject: string;
  html: string;
} {
  const subject = `⏰ Mañana es tu servicio · ${d.hostName}`;
  const itemsHtml = d.items
    .map((it) => {
      const time = it.serviceTime ? ` · 🕒 ${escapeHtml(it.serviceTime)}` : "";
      const pickup = it.pickupLocation
        ? `<p style="margin:4px 0 0;font-size:11px;color:#64748b">📍 ${escapeHtml(it.pickupLocation)}</p>`
        : "";
      return `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #e2e8f0">
          <p style="margin:0;font-size:14px;font-weight:600">${escapeHtml(it.name)}${time}</p>
          ${pickup}
        </td>
      </tr>`;
    })
    .join("");

  const pinBlock = d.redemptionPin
    ? `<div style="background:#fef3c7;border:2px dashed #f59e0b;border-radius:14px;padding:18px;text-align:center;margin-bottom:16px">
        <p style="margin:0;font-size:10px;font-weight:700;color:#92400e;letter-spacing:1.5px;text-transform:uppercase">🎟 Tu PIN de entrega</p>
        <p style="margin:8px 0 4px;font-size:32px;font-weight:800;font-family:Menlo,Monaco,monospace;letter-spacing:8px;color:#1e293b">${escapeHtml(d.redemptionPin)}</p>
        <p style="margin:0;font-size:11px;color:#78716c">Mostralo al proveedor al llegar.</p>
      </div>`
    : "";

  const ctaBlock = d.orderUrl
    ? `<a href="${escapeHtml(d.orderUrl)}" style="display:block;background:#1e293b;color:#ffffff;padding:14px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;text-align:center;margin-top:12px">Ver mi pase con QR ↗</a>`
    : "";

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,sans-serif;color:#1e293b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 16px">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:18px;overflow:hidden">
<tr><td style="background:linear-gradient(135deg,#3b82f6,#1d4ed8);padding:28px;text-align:center;color:#fff">
  <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;opacity:0.9">⏰ Recordatorio</p>
  <p style="margin:8px 0 0;font-size:24px;font-weight:800">Mañana tenés tu servicio</p>
</td></tr>
<tr><td style="padding:24px">
  <p style="margin:0 0 14px;font-size:15px">¡Hola <strong>${escapeHtml(d.guestName)}</strong>!</p>
  <p style="margin:0 0 18px;font-size:13px;color:#475569;line-height:1.6">
    Te recordamos que mañana tenés reservado un servicio con <strong>${escapeHtml(d.hostName)}</strong>. Acá los detalles:
  </p>
  ${pinBlock}
  <table role="presentation" width="100%">${itemsHtml}</table>
  ${ctaBlock}
  <p style="margin:18px 0 0;font-size:11px;color:#94a3b8;text-align:center">
    Si necesitás cambiar algo, contactá al host directamente.
  </p>
</td></tr>
</table></td></tr></table>
</body></html>`;

  return { subject, html };
}

// ─── Recordatorio al vendor ──────────────────────────────────────────────────
type ReminderVendorData = {
  vendorName: string;
  hostName: string;
  guestName: string;
  guestPhone: string | null;
  total: number;
  currency: string;
  items: ReminderItem[];
  manageUrl: string;
};

export function renderReminderVendorEmail(d: ReminderVendorData): {
  subject: string;
  html: string;
} {
  const subject = `⏰ Mañana atendés a ${d.guestName}`;
  const itemsHtml = d.items
    .map((it) => {
      const details: string[] = [];
      if (it.serviceDate) details.push(`📅 ${escapeHtml(it.serviceDate)}`);
      if (it.serviceTime) details.push(`🕒 ${escapeHtml(it.serviceTime)}`);
      if (it.pickupLocation) details.push(`📍 ${escapeHtml(it.pickupLocation)}`);
      if (it.flightNumber) details.push(`✈️ ${escapeHtml(it.flightNumber)}`);
      const detailsHtml = details.length > 0
        ? `<p style="margin:4px 0 0;font-size:12px;color:#475569">${details.join(" · ")}</p>`
        : "";
      return `<tr>
        <td style="padding:12px 0;border-bottom:1px solid #e2e8f0">
          <p style="margin:0;font-size:14px;font-weight:600">${escapeHtml(it.name)}</p>
          ${detailsHtml}
        </td>
        <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;font-size:13px">${escapeHtml(formatMoney(it.lineTotal, d.currency))}</td>
      </tr>`;
    })
    .join("");

  const guestContact = d.guestPhone
    ? `<a href="https://wa.me/${escapeHtml(d.guestPhone.replace(/\D/g, ""))}" style="display:inline-block;background:#10b981;color:#fff;padding:8px 14px;border-radius:20px;text-decoration:none;font-weight:600;font-size:12px;margin-top:4px">💬 WhatsApp ${escapeHtml(d.guestPhone)}</a>`
    : "";

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,sans-serif;color:#1e293b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 16px">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:18px;overflow:hidden">
<tr><td style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:28px;text-align:center;color:#fff">
  <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;opacity:0.9">⏰ Recordatorio para mañana</p>
  <p style="margin:8px 0 0;font-size:22px;font-weight:800">Servicio para ${escapeHtml(d.guestName)}</p>
  <p style="margin:4px 0 0;font-size:12px;opacity:0.9">vía ${escapeHtml(d.hostName)}</p>
</td></tr>
<tr><td style="padding:24px">
  <p style="margin:0 0 14px;font-size:15px">Hola <strong>${escapeHtml(d.vendorName)}</strong>,</p>
  <p style="margin:0 0 18px;font-size:13px;color:#475569;line-height:1.6">
    Te recordamos el servicio que tenés para entregar mañana.
  </p>
  <a href="${escapeHtml(d.manageUrl)}" style="display:block;background:#1e293b;color:#fff;padding:14px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;text-align:center;margin-bottom:18px">Abrir gestión de la orden →</a>
  <table role="presentation" width="100%">${itemsHtml}</table>
  <p style="margin:16px 0 6px;font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase">Contacto del huésped</p>
  <p style="margin:0;font-size:14px;font-weight:600">${escapeHtml(d.guestName)}</p>
  ${guestContact}
  <p style="margin:18px 0 0;padding:12px;background:#fef3c7;border-left:3px solid #f59e0b;border-radius:6px;font-size:11px;color:#92400e">
    <strong>Recordá:</strong> al entregar, pedile al huésped que te muestre el <strong>QR</strong> o te dicte el <strong>PIN de 6 dígitos</strong>.
  </p>
</td></tr>
</table></td></tr></table>
</body></html>`;

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
