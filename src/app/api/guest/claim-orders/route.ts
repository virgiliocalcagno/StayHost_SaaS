/**
 * POST /api/guest/claim-orders
 *
 * Inicia el flow para reclamar órdenes hechas con un email distinto al
 * que el huésped usa para loguearse. Genera un OTP de 6 chars, lo guarda
 * hasheado, y lo envía al email reclamado.
 *
 * Solo accesible si hay sesión Supabase activa (el OTP atrapa al user_id
 * actual; al validar, se reclamarán órdenes para ESE user).
 *
 * Body: { email: string }
 *
 * Anti-abuse:
 *   - Rate limit suave: si ya hay un código no-usado en los últimos 60s
 *     para el mismo (user_id, email), devolvemos error 429.
 *   - Code random crypto.randomBytes(3).toString("hex") → 6 hex chars.
 *   - Hash sha256 (suficiente para OTPs cortos, no necesitamos bcrypt).
 *
 * Respuesta no revela si el email tiene órdenes asociadas — siempre OK.
 * Defensa contra enumeration: un atacante no debería poder saber qué
 * emails compraron en StayHost via este endpoint.
 */
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/send";
import { createHash, randomBytes } from "crypto";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CODE_TTL_MIN = 30;
const COOLDOWN_SEC = 60;

function generateCode(): string {
  // 3 bytes = 6 hex chars. Mayúsculas para presentación.
  return randomBytes(3).toString("hex").toUpperCase();
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Email inválido" }, { status: 400 });
  }

  // Defensa: el huésped no puede reclamar su PROPIO email (ya pasa por
  // auto-claim en /api/guest/me). Avisamos para que no se confunda.
  if (user.email && user.email.toLowerCase() === email) {
    return NextResponse.json(
      { error: "Ese es tu email actual. Las órdenes con ese email ya están vinculadas." },
      { status: 400 },
    );
  }

  // Rate limit: si hubo un code emitido en los últimos COOLDOWN_SEC para
  // (user, email) sin usar todavía, no generamos uno nuevo.
  const cooldownIso = new Date(Date.now() - COOLDOWN_SEC * 1000).toISOString();
  const { data: recent } = await supabaseAdmin
    .from("guest_claim_codes")
    .select("id, created_at")
    .eq("user_id", user.id)
    .ilike("email", email)
    .is("used_at", null)
    .gt("created_at", cooldownIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent) {
    return NextResponse.json(
      { error: "Esperá 1 minuto antes de pedir otro código." },
      { status: 429 },
    );
  }

  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MIN * 60 * 1000).toISOString();

  const { error: insErr } = await supabaseAdmin
    .from("guest_claim_codes")
    .insert({
      user_id: user.id,
      email,
      code_hash: codeHash,
      expires_at: expiresAt,
    } as never);
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // Mandar el code al email viejo. Si falla el envío, igual devolvemos
  // OK al cliente — no queremos revelar si el email es válido.
  try {
    await sendEmail({
      to: email,
      subject: `Código de verificación StayHost: ${code}`,
      fromName: "StayHost",
      html: `<!doctype html><html><body style="font-family:-apple-system,sans-serif;background:#f1f5f9;padding:24px">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;text-align:center">
  <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:1.5px;color:#f59e0b;text-transform:uppercase">Reclamar pedidos</p>
  <h1 style="margin:8px 0 16px;font-size:22px;color:#1e293b">Tu código de verificación</h1>
  <p style="margin:0 0 24px;font-size:14px;color:#475569">
    Alguien (probablemente vos) pidió asociar las órdenes hechas con este email a otra cuenta.
    Pegá este código en la página para confirmar:
  </p>
  <p style="margin:24px 0;font-size:36px;font-weight:700;letter-spacing:8px;color:#f59e0b;font-family:monospace">${code}</p>
  <p style="margin:0;font-size:12px;color:#94a3b8">Vence en ${CODE_TTL_MIN} minutos.</p>
  <p style="margin:16px 0 0;font-size:11px;color:#94a3b8">
    Si no fuiste vos, podés ignorar este email. Nadie va a poder asociar
    tus pedidos sin este código.
  </p>
</div>
</body></html>`,
    });
  } catch (e) {
    console.error("[claim-orders] email send failed:", e);
  }

  return NextResponse.json({ ok: true });
}
