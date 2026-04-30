/**
 * Helper centralizado para enviar emails transaccionales desde StayHost.
 *
 * Provider: Resend (3k/mes free; cuando crezcamos pasamos a Pro $20/mes
 * por 50k emails).
 *
 * Decisión arquitectural: cuenta CENTRALIZADA de StayHost. Todos los
 * emails salen desde un dominio único (configurable via EMAIL_FROM_ADDRESS).
 * Para que el huésped pueda responder al host real, cada email setea
 * `replyTo: tenant.contact_email`. Así el huésped responde "tengo dudas"
 * y la respuesta llega directo al host, sin pasar por StayHost.
 *
 * Soft-fail: si RESEND_API_KEY no está configurada (preview branch sin
 * env vars, dev local sin cuenta), el helper devuelve { ok: false } sin
 * tirar excepción. La feature de email es no-bloqueante: el flow del
 * pago sigue funcionando aunque el email falle.
 */
import { Resend } from "resend";

type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
  /** Email del host: cuando el huésped responde, llega al host directo */
  replyTo?: string | null;
  /** Nombre que aparece en el "From:" — ej. "Villas del Caribe via StayHost" */
  fromName?: string;
};

type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

let cachedClient: Resend | null = null;
function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (cachedClient) return cachedClient;
  cachedClient = new Resend(key);
  return cachedClient;
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const client = getClient();
  if (!client) {
    console.warn("[email] RESEND_API_KEY no configurada — saltando envío de email");
    return { ok: false, error: "Email no configurado" };
  }

  // From por default: usa onboarding@resend.dev hasta que tengamos dominio
  // verificado en Resend (configurable con EMAIL_FROM_ADDRESS).
  const fromAddress = process.env.EMAIL_FROM_ADDRESS ?? "onboarding@resend.dev";
  const fromName = args.fromName ?? "StayHost";
  const from = `${fromName} <${fromAddress}>`;

  try {
    const { data, error } = await client.emails.send({
      from,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      replyTo: args.replyTo ?? undefined,
    });
    if (error) {
      console.error("[email] Resend error:", error);
      return { ok: false, error: error.message ?? "Error desconocido" };
    }
    return { ok: true, id: data?.id ?? "unknown" };
  } catch (err) {
    console.error("[email] send threw:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
