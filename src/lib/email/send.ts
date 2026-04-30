/**
 * Helper centralizado para enviar emails transaccionales desde StayHost.
 *
 * Provider: SMTP (nodemailer). Configurado para Gmail por defecto, pero
 * funciona con cualquier servidor SMTP (cuando migremos a un provider
 * dedicado como Resend, solo cambian las env vars).
 *
 * Decisión arquitectural: cuenta CENTRALIZADA de StayHost. Todos los
 * emails salen desde un dominio único (configurable via EMAIL_FROM_ADDRESS).
 * Para que el huésped pueda responder al host real, cada email setea
 * `replyTo: tenant.contact_email`. Así el huésped responde "tengo dudas"
 * y la respuesta llega directo al host, sin pasar por StayHost.
 *
 * Soft-fail: si SMTP_HOST/USER/PASS no están configuradas (preview branch
 * sin env vars, dev local sin cuenta), el helper devuelve { ok: false }
 * sin tirar excepción. La feature de email es no-bloqueante: el flow del
 * pago sigue funcionando aunque el email falle.
 *
 * Gmail nota: la SMTP_PASS NO es la contraseña de la cuenta — es un
 * "App Password" de 16 caracteres generado en
 * https://myaccount.google.com/apppasswords. Es lo mismo que el host
 * pegó en Supabase Auth → SMTP Settings.
 */
import nodemailer, { type Transporter } from "nodemailer";

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

let cachedTransporter: Transporter | null = null;
function getTransporter(): Transporter | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = Number(process.env.SMTP_PORT ?? 587);
  if (!host || !user || !pass) return null;
  if (cachedTransporter) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    // STARTTLS en 587 (Gmail). 465 usa SMTPS directo (secure: true).
    secure: port === 465,
    auth: { user, pass },
  });
  return cachedTransporter;
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn("[email] SMTP no configurado (faltan SMTP_HOST/USER/PASS) — saltando envío");
    return { ok: false, error: "Email no configurado" };
  }

  // From por default: usa SMTP_USER si no está EMAIL_FROM_ADDRESS. Gmail
  // exige que el From coincida con el usuario autenticado (no se puede
  // spoofear) salvo que tengas dominio configurado en Google Workspace.
  const fromAddress = process.env.EMAIL_FROM_ADDRESS ?? process.env.SMTP_USER ?? "noreply@stayhost.com";
  const fromName = args.fromName ?? "StayHost";
  const from = `"${fromName}" <${fromAddress}>`;

  try {
    const info = await transporter.sendMail({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      replyTo: args.replyTo ?? undefined,
    });
    return { ok: true, id: info.messageId ?? "unknown" };
  } catch (err) {
    console.error("[email] sendMail threw:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
