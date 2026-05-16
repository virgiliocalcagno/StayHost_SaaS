// Helpers para redención de service orders (QR + PIN).
//
// Usado por:
//   - /api/public/hub/[hostId]/service-order POST → genera token + PIN al crear
//   - /api/vendor/redeem POST → valida y marca delivered
//   - Email de confirmación al huésped → embebe QR + PIN
//
// Diseño:
//   - Token: 32-char hex UUID, crypto.randomUUID(). Va DENTRO del QR como
//     query param. NUNCA se muestra al huésped tipeado.
//   - PIN: 6 chars del alfabeto SAFE_ALPHABET. Es el fallback si el QR
//     falla. Mostrado como texto grande al huésped + al final del email.

/**
 * Alfabeto seguro para PINs dictados por voz/teléfono:
 * - Sin 0 (cero) ni O (letra) — se confunden
 * - Sin 1, I, L — todas se ven iguales en mayúsculas
 * - Sin caracteres ambiguos en distintos charsets
 *
 * 24 caracteres × 6 posiciones = 191M combinaciones. Suficiente para que
 * un vendor no adivine un PIN ajeno y a la vez fácil de dictar.
 */
const SAFE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Genera un PIN de 6 caracteres del alfabeto seguro.
 *
 * Usa crypto.getRandomValues — equivalente cripto a Math.random pero
 * resistente a predicción. Importante: no caer a Math.random por accidente.
 */
export function generateRedemptionPin(length = 6): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let pin = "";
  for (let i = 0; i < length; i++) {
    pin += SAFE_ALPHABET[bytes[i] % SAFE_ALPHABET.length];
  }
  return pin;
}

/**
 * Genera el token largo del QR. Es un UUID v4 sin guiones (32 chars hex).
 * Resistente a colisión incluso a escala global.
 */
export function generateRedemptionToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * Normaliza un PIN tipeado por el vendor antes de comparar:
 * - Upper case
 * - Quita espacios
 * - Sustituye visualmente confusos (O→0 NO — el alfabeto no usa 0/1/I/O/L,
 *   pero si el vendor tipea "O" pensando en 0, lo dejamos fallar para que
 *   sepa que el PIN no es ese — fail explícito vs auto-corregir mal).
 *
 * Si el vendor tipea "h4p9k2" lo aceptamos como "H4P9K2".
 */
export function normalizePin(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, "");
}

/**
 * Validador defensivo: PIN debe ser exactamente N chars del alfabeto.
 * Útil antes de pegar a BD para evitar "lookups" con basura larga.
 */
export function isValidPinFormat(pin: string, length = 6): boolean {
  if (pin.length !== length) return false;
  for (const c of pin) {
    if (!SAFE_ALPHABET.includes(c)) return false;
  }
  return true;
}
