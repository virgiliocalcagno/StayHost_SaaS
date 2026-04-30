/**
 * Template HTML para el email "Tu reserva está confirmada" que recibe
 * el huésped después de pagar. Inline CSS porque Gmail/Outlook no
 * soportan <style> bloques externos consistente.
 *
 * Tono: cálido pero profesional (estilo Airbnb post-booking). El
 * huésped tiene que sentir que la reserva está REAL y tener TODO lo
 * que necesita sin pasar por WhatsApp.
 */

type GuestPaidEmailData = {
  guestName: string;
  channelCode: string | null;
  propertyName: string;
  propertyAddress: string;
  hostName: string;
  hostWhatsapp: string | null;
  hostEmail: string | null;
  hostWelcomeMessage: string | null;
  checkIn: string;
  checkOut: string;
  numGuests: number | null;
  total: number;
  currency: string;
  paymentId: string;
  payUrl: string;
};

export function renderGuestPaidEmail(d: GuestPaidEmailData): { subject: string; html: string } {
  const subject = d.channelCode
    ? `Reserva confirmada · ${d.channelCode} · ${d.propertyName}`
    : `Reserva confirmada · ${d.propertyName}`;

  const waLink = d.hostWhatsapp
    ? `https://wa.me/${d.hostWhatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(
        `Hola ${d.hostName}, soy ${d.guestName}. Acabo de pagar mi reserva (${d.channelCode ?? ""}) — quedo atento/a a las instrucciones de check-in. ¡Gracias!`
      )}`
    : null;

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#FDFBF7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FDFBF7;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:24px;border:1px solid #e2e8f0;overflow:hidden">

        <!-- Header -->
        <tr><td style="padding:32px 32px 16px;text-align:center">
          <p style="margin:0;font-size:12px;font-weight:700;color:#059669;letter-spacing:1px;text-transform:uppercase">✓ Pago confirmado</p>
          <h1 style="margin:8px 0 0;font-size:28px;font-weight:800;color:#0f172a">¡Tu reserva está lista!</h1>
          <p style="margin:8px 0 0;font-size:14px;color:#64748b">Hola ${escapeHtml(d.guestName)}, recibimos tu pago.</p>
        </td></tr>

        <!-- Codigo grande -->
        ${d.channelCode ? `
        <tr><td style="padding:0 32px">
          <div style="background:linear-gradient(135deg,#ecfdf5,#d1fae5);border:2px solid #6ee7b7;border-radius:20px;padding:24px;text-align:center">
            <p style="margin:0;font-size:11px;font-weight:700;color:#059669;letter-spacing:1.5px;text-transform:uppercase">Tu código de reserva</p>
            <p style="margin:8px 0 0;font-size:32px;font-weight:800;color:#064e3b;letter-spacing:2px;font-family:Menlo,Monaco,monospace">${escapeHtml(d.channelCode)}</p>
            <p style="margin:8px 0 0;font-size:12px;color:#047857">Lo vas a necesitar para tu check-in</p>
          </div>
        </td></tr>
        ` : ""}

        <!-- Resumen -->
        <tr><td style="padding:24px 32px 8px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:16px;padding:20px">
            <tr><td style="padding:0 0 12px">
              <p style="margin:0;font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase">Propiedad</p>
              <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#0f172a">${escapeHtml(d.propertyName)}</p>
              ${d.propertyAddress ? `<p style="margin:4px 0 0;font-size:13px;color:#64748b">📍 ${escapeHtml(d.propertyAddress)}</p>` : ""}
            </td></tr>
            <tr><td style="padding:12px 0;border-top:1px solid #e2e8f0">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:50%;vertical-align:top">
                    <p style="margin:0;font-size:10px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase">Check-in</p>
                    <p style="margin:4px 0 0;font-size:14px;font-weight:700">${escapeHtml(d.checkIn)}</p>
                  </td>
                  <td style="width:50%;vertical-align:top">
                    <p style="margin:0;font-size:10px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase">Check-out</p>
                    <p style="margin:4px 0 0;font-size:14px;font-weight:700">${escapeHtml(d.checkOut)}</p>
                  </td>
                </tr>
              </table>
            </td></tr>
            ${d.numGuests ? `
            <tr><td style="padding:12px 0;border-top:1px solid #e2e8f0">
              <p style="margin:0;font-size:10px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase">Huéspedes</p>
              <p style="margin:4px 0 0;font-size:14px;font-weight:700">${d.numGuests}</p>
            </td></tr>
            ` : ""}
            <tr><td style="padding:12px 0 0;border-top:1px solid #e2e8f0">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td><p style="margin:0;font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px">Pagado</p></td>
                  <td align="right"><p style="margin:0;font-size:22px;font-weight:800;color:#059669">$${d.total.toLocaleString()} ${escapeHtml(d.currency)}</p></td>
                </tr>
              </table>
              <p style="margin:4px 0 0;font-size:11px;color:#94a3b8;font-family:Menlo,Monaco,monospace">ID transacción: ${escapeHtml(d.paymentId)}</p>
            </td></tr>
          </table>
        </td></tr>

        <!-- Mensaje del host -->
        ${d.hostWelcomeMessage ? `
        <tr><td style="padding:8px 32px">
          <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:12px;padding:16px">
            <p style="margin:0;font-size:11px;font-weight:700;color:#92400e;letter-spacing:1px;text-transform:uppercase">Mensaje de ${escapeHtml(d.hostName)}</p>
            <p style="margin:8px 0 0;font-size:14px;color:#78350f;font-style:italic">"${escapeHtml(d.hostWelcomeMessage)}"</p>
          </div>
        </td></tr>
        ` : ""}

        <!-- Contacto del host -->
        <tr><td style="padding:24px 32px 8px">
          <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase">Tu host</p>
          <p style="margin:0;font-size:16px;font-weight:700;color:#0f172a">${escapeHtml(d.hostName)}</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px">
            <tr>
              ${waLink ? `
              <td style="padding-right:6px;width:50%">
                <a href="${waLink}" style="display:block;background:#10b981;color:#ffffff;text-decoration:none;padding:14px;border-radius:12px;text-align:center;font-weight:700;font-size:14px">💬 WhatsApp</a>
              </td>
              ` : ""}
              ${d.hostEmail ? `
              <td style="padding-left:${waLink ? "6px" : "0"};width:${waLink ? "50%" : "100%"}">
                <a href="mailto:${escapeHtml(d.hostEmail)}?subject=Reserva%20${encodeURIComponent(d.channelCode ?? "")}" style="display:block;background:#f1f5f9;color:#0f172a;text-decoration:none;padding:14px;border-radius:12px;text-align:center;font-weight:700;font-size:14px">✉ Email</a>
              </td>
              ` : ""}
            </tr>
          </table>
        </td></tr>

        <!-- Próximos pasos -->
        <tr><td style="padding:24px 32px">
          <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#64748b;letter-spacing:1px;text-transform:uppercase">Próximos pasos</p>
          <ol style="margin:0;padding-left:20px;font-size:14px;color:#334155;line-height:1.6">
            <li>Guardá este email — vas a necesitar tu código <strong>${escapeHtml(d.channelCode ?? "de reserva")}</strong> al hacer check-in.</li>
            <li>Tu host te va a contactar 24-48hs antes de tu llegada con dirección exacta y código de acceso o llaves.</li>
            <li>Si necesitás algo, escribí directo al host por WhatsApp con tu código de reserva — responde más rápido que el email.</li>
          </ol>
        </td></tr>

        <!-- Link a pagina online -->
        <tr><td style="padding:0 32px 32px;text-align:center">
          <a href="${d.payUrl}" style="display:inline-block;color:#64748b;text-decoration:underline;font-size:12px">Ver esta reserva online</a>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0">
          <p style="margin:0;font-size:11px;color:#94a3b8">Este email fue enviado vía StayHost en nombre de ${escapeHtml(d.hostName)}.</p>
          <p style="margin:4px 0 0;font-size:11px;color:#94a3b8">Si tenés preguntas, respondé este email — le llega al host directo.</p>
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
