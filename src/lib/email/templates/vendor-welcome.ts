/**
 * Email al VENDOR cuando el host lo registra en StayHost.
 *
 * Le manda el magic-link de su portal permanente (`/vendor/{portal_token}`)
 * para que pueda:
 *   - Activar notificaciones push antes de la primera orden
 *   - Instalar la PWA en su celular
 *   - Ver todas sus órdenes (cuando lleguen)
 *
 * Ese link NO caduca. El vendor lo guarda como bookmark / pantalla de
 * inicio de su celular y ya no necesita pedirle al host que se lo
 * reenvíe.
 */

type WelcomeData = {
  vendorName: string;
  hostName: string;
  portalUrl: string;
};

export function renderVendorWelcomeEmail(d: WelcomeData): {
  subject: string;
  html: string;
} {
  const safeName = escapeHtml(d.vendorName);
  const safeHost = escapeHtml(d.hostName);

  const subject = `Tu portal de StayHost — pedidos de ${d.hostName}`;

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px">
  <div style="background:#fff;border-radius:16px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
    <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:1.5px;color:#f59e0b;text-transform:uppercase">
      🎉 Bienvenido a StayHost
    </p>
    <h1 style="margin:8px 0 16px;font-size:24px;color:#1e293b;line-height:1.3">
      Hola ${safeName}, tu portal está listo
    </h1>
    <p style="margin:0;font-size:15px;color:#475569;line-height:1.6">
      <strong>${safeHost}</strong> te registró como proveedor en su tienda online. Cuando un huésped reserve uno de tus servicios, vas a recibir el pedido acá:
    </p>

    <a href="${d.portalUrl}" style="display:block;background:linear-gradient(135deg,#f59e0b,#ea580c);color:#fff;padding:18px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px;text-align:center;margin:24px 0;box-shadow:0 4px 12px rgba(234,88,12,0.3)">
      Abrir mi portal →
    </a>

    <div style="background:#fef3c7;border-radius:12px;padding:16px;margin:16px 0">
      <p style="margin:0;font-size:13px;color:#78350f;font-weight:700">📌 Guardá este link</p>
      <p style="margin:6px 0 0;font-size:12px;color:#92400e;line-height:1.5">
        Es tu portal permanente — guardalo como marcador o instalalo como app en tu celular para acceso rápido. <strong>El link no caduca.</strong>
      </p>
    </div>

    <h2 style="font-size:15px;color:#1e293b;margin:24px 0 12px">¿Qué podés hacer ahí?</h2>
    <ul style="margin:0;padding-left:20px;font-size:13px;color:#475569;line-height:1.7">
      <li>Ver todos los pedidos que te asignaron (pendientes, confirmados, entregados)</li>
      <li>Confirmar o declinar pedidos con un clic</li>
      <li>Marcar entregas con el PIN del huésped</li>
      <li>Activar notificaciones push para enterarte al instante de nuevos pedidos</li>
      <li>Instalar la app en tu celular para tenerla a mano</li>
    </ul>

    <p style="margin:24px 0 0;font-size:13px;color:#64748b;line-height:1.6">
      <strong>Tip:</strong> al entrar al portal, activá notificaciones e instalá la app. Así no se te escapa ningún pedido.
    </p>

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">

    <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.6;text-align:center">
      Si no esperabas este email, podés ignorarlo. Para cualquier duda, hablá directamente con ${safeHost}.<br>
      StayHost — sistema operativo para hosts de Airbnb en Punta Cana.
    </p>
  </div>
</div>
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
