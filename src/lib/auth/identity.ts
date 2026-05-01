/**
 * Identity helpers — soporta login con email O teléfono.
 *
 * Supabase Auth solo entiende email + password. Para soportar staff sin
 * email real (común en LATAM con limpiadoras de barrio), generamos un
 * pseudo-email determinístico basado en el teléfono + tenantId. Ese
 * pseudo-email se guarda en `auth.users.email` y en `team_members.email`,
 * pero el usuario nunca lo escribe — solo conoce su número de teléfono.
 *
 * Decisión 2026-05-01 — ver memoria project_staff_auth_decision.md
 */

const PSEUDO_EMAIL_DOMAIN = "stayhost.local";

/** Detecta si el input parece un email (contiene @). */
export function looksLikeEmail(input: string): boolean {
  return input.includes("@");
}

/**
 * Normaliza un teléfono al formato `+[dígitos]`.
 * Acepta input con espacios, guiones, paréntesis. Tolerante con o sin `+`.
 *
 * Devuelve null si no quedan dígitos suficientes (mínimo 8, para cubrir
 * desde fijos cortos hasta internacionales largos).
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length < 8) return null;
  return `+${digits}`;
}

/**
 * Construye el pseudo-email para un teléfono dado dentro de un tenant.
 * Formato: `+18091234567+{tenantIdShort}@stayhost.local`.
 *
 * Usamos los primeros 8 chars del tenantId (UUID) como sufijo para evitar
 * que dos tenants con la misma limpiadora colisionen en auth.users (que
 * es global, no scopeado por tenant).
 */
export function buildPseudoEmail(phone: string, tenantId: string): string {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    throw new Error("buildPseudoEmail: phone inválido");
  }
  const tenantShort = tenantId.replace(/-/g, "").slice(0, 8);
  return `${normalized}+${tenantShort}@${PSEUDO_EMAIL_DOMAIN}`;
}

/**
 * Resuelve un identificador de login (email o teléfono) al email real
 * que Supabase Auth espera. Útil en `/acceso` LoginForm.
 *
 * - Si el input contiene `@` → asumimos email, se devuelve trim+lowercase.
 * - Si no, asumimos teléfono. Necesitamos el tenantId para construir el
 *   pseudo-email. Si no lo tenemos (login universal sin tenant), el
 *   caller debe resolverlo primero — devolvemos null.
 *
 * Nota: el LoginForm cliente no conoce el tenantId del usuario antes de
 * loguearse. Para el caso phone, usamos un endpoint server `/api/auth/resolve`
 * que busca en team_members por phone y devuelve el pseudo-email.
 */
export function resolveEmailIdentifier(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (looksLikeEmail(trimmed)) return trimmed.toLowerCase();
  return null;
}

/** Detecta si un email es uno de nuestros pseudo-emails sintéticos. */
export function isPseudoEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${PSEUDO_EMAIL_DOMAIN}`);
}
