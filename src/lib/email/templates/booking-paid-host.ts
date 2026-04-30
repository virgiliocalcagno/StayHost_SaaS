/**
 * Template HTML para el email "Nueva reserva pagada" que recibe el HOST
 * cuando un huésped paga via Hub público + PayPal. El host ya no tiene
 * que ir al panel para enterarse — el email tiene todo lo crítico:
 *   - código de reserva, fechas, importe
 *   - datos del huésped (nombre, teléfono, email)
 *   - link al panel para ver foto del documento + detalles
 *
 * Tono: directo, ejecutivo. El host es operativo y necesita decidir
 * acciones rápido (preparar la propiedad, enviar instrucciones de
 * check-in al huésped).
 */

type HostPaidEmailData = {
  hostName: string;
  channelCode: string | null;
  propertyName: string;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  checkIn: string;
  checkOut: string;
  numGuests: number | null;
  total: number;
  currency: string;
  paymentId: string;
  dashboardUrl: string;
};

export function renderHostPaidEmail(d: HostPaidEmailData): { subject: string; html: string } {
  const subject = d.channelCode
    ? `💰 Nueva reserva pagada · ${d.channelCode} · ${d.propertyName}`
    : `💰 Nueva reserva pagada · ${d.propertyName}`;

  const waLink = d.guestPhone
    ? `https://wa.me/${d.guestPhone.replace(/\D/g, "")}?text=${encodeURIComponent(
        `Hola ${d.guestName}! Soy ${d.hostName}, tu host en ${d.propertyName}. Confirmamos tu reserva del ${d.checkIn} al ${d.checkOut} (código ${d.channelCode ?? ""}). Te paso los detalles de check-in...`
      )}`
    : null;

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

        <!-- Header con monto destacado -->
        <tr><td style="background:linear-gradient(135deg,#059669,#10b981);padding:28px 32px;text-align:center;color:#ffffff">
          <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;opacity:0.9">💰 Pago recibido</p>
          <p style="margin:8px 0 0;font-size:36px;font-weight:800">$${d.total.toLocaleString()} ${escapeHtml(d.currency)}</p>
          ${d.channelCode ? `<p style="margin:8px 0 0;font-size:14px;font-family:Menlo,Monaco,monospace;background:rgba(255,255,255,0.2);display:inline-block;padding:4px 12px;border-radius:20px">${escapeHtml(d.channelCode)}</p>` : ""}
        </td></tr>

        <!-- Datos del booking -->
        <tr><td style="padding:24px 32px">
          <p style="margin:0;font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase">Reserva confirmada</p>
          <p style="margin:6px 0 16px;font-size:18px;font-weight:700">${escapeHtml(d.propertyName)}</p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;padding:16px">
            <tr>
              <td style="width:50%;vertical-align:top;padding:4px 0">
                <p style="margin:0;font-size:10px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase">Check-in</p>
                <p style="margin:4px 0 0;font-size:14px;font-weight:700">${escapeHtml(d.checkIn)}</p>
              </td>
              <td style="width:50%;vertical-align:top;padding:4px 0">
                <p style="margin:0;font-size:10px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase">Check-out</p>
                <p style="margin:4px 0 0;font-size:14px;font-weight:700">${escapeHtml(d.checkOut)}</p>
              </td>
            </tr>
            ${d.numGuests ? `
            <tr><td colspan="2" style="padding:12px 0 0;border-top:1px solid #e2e8f0">
              <p style="margin:0;font-size:10px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase">Huéspedes</p>
              <p style="margin:4px 0 0;font-size:14px;font-weight:700">${d.numGuests}</p>
            </td></tr>
            ` : ""}
          </table>
        </td></tr>

        <!-- Datos del huésped -->
        <tr><td style="padding:0 32px 16px">
          <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase">Huésped principal</p>
          <p style="margin:0;font-size:16px;font-weight:700">${escapeHtml(d.guestName)}</p>
          ${d.guestPhone ? `<p style="margin:4px 0 0;font-size:13px;color:#475569">📱 ${escapeHtml(d.guestPhone)}</p>` : ""}
          ${d.guestEmail ? `<p style="margin:4px 0 0;font-size:13px;color:#475569">✉ ${escapeHtml(d.guestEmail)}</p>` : ""}
        </td></tr>

        <!-- Acciones -->
        <tr><td style="padding:8px 32px 24px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              ${waLink ? `
              <td style="padding-right:6px;width:50%">
                <a href="${waLink}" style="display:block;background:#10b981;color:#ffffff;text-decoration:none;padding:14px;border-radius:12px;text-align:center;font-weight:700;font-size:14px">💬 Contactar al huésped</a>
              </td>
              ` : ""}
              <td style="padding-left:${waLink ? "6px" : "0"};width:${waLink ? "50%" : "100%"}">
                <a href="${d.dashboardUrl}" style="display:block;background:#0f172a;color:#ffffff;text-decoration:none;padding:14px;border-radius:12px;text-align:center;font-weight:700;font-size:14px">Ver en panel</a>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Próximos pasos -->
        <tr><td style="padding:0 32px 24px">
          <div style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:8px;padding:16px">
            <p style="margin:0;font-size:13px;font-weight:700;color:#92400e">⚠ Próximos pasos</p>
            <ul style="margin:8px 0 0;padding-left:20px;font-size:13px;color:#78350f;line-height:1.6">
              <li>Mandale las instrucciones de check-in 24h antes (dirección exacta, código de acceso o ubicación de llaves).</li>
              <li>Verificá el documento de identidad del huésped en el panel antes del día de llegada.</li>
              <li>Programá la limpieza si no está coordinada.</li>
            </ul>
          </div>
        </td></tr>

        <!-- Footer técnico -->
        <tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0">
          <p style="margin:0;font-size:11px;color:#94a3b8">ID transacción PayPal: <span style="font-family:Menlo,Monaco,monospace">${escapeHtml(d.paymentId)}</span></p>
          <p style="margin:4px 0 0;font-size:11px;color:#94a3b8">El pago fue procesado directo a tu cuenta PayPal. StayHost no retiene fondos.</p>
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
    .replace(/'/g, "&#039;");
}
