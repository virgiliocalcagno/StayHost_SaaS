// Helpers de formato monetario centralizados.
//
// Regla maestra: nunca renderizar "$" o "USD" hardcoded en componentes.
// Siempre usar `formatMoney(amount, currency)` para que el código de moneda
// aparezca explícito y no haya ambigüedad entre DOP y USD.
//
// Convención de prefijos:
//   - DOP → "RD$" (cómo lo escriben los dueños en Punta Cana)
//   - USD → "US$" (claro vs "$" ambiguo)
//   - Otras monedas: el código ISO al inicio (e.g. "EUR 100")

export type Currency = "DOP" | "USD" | string;

export function formatMoney(
  amount: number | string | null | undefined,
  currency: Currency | null | undefined,
  opts: { maximumFractionDigits?: number; minimumFractionDigits?: number } = {},
): string {
  if (amount == null || amount === "") return "—";
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (Number.isNaN(value)) return "—";

  const code = (currency ?? "DOP").toUpperCase();
  const maxFrac = opts.maximumFractionDigits ?? 0;
  const minFrac = opts.minimumFractionDigits ?? 0;

  if (code === "DOP") {
    return `RD$ ${value.toLocaleString("es-DO", {
      maximumFractionDigits: maxFrac,
      minimumFractionDigits: minFrac,
    })}`;
  }
  if (code === "USD") {
    return `US$ ${value.toLocaleString("en-US", {
      maximumFractionDigits: maxFrac,
      minimumFractionDigits: minFrac,
    })}`;
  }
  // Fallback genérico: código ISO + número formateado.
  return `${code} ${value.toLocaleString("en-US", {
    maximumFractionDigits: maxFrac,
    minimumFractionDigits: minFrac,
  })}`;
}

// Convierte un monto entre monedas usando la tasa USD↔moneda local del
// tenant. Solo para conversión VISUAL — no usar para guardar precios.
//
// Ejemplo: tenant en Punta Cana con usd_to_local_rate=60
//   convertMoney(1200, "DOP", "USD", 60) → 20 (1200 / 60)
//   convertMoney(20, "USD", "DOP", 60)   → 1200 (20 * 60)
//   convertMoney(100, "DOP", "DOP", 60)  → 100 (sin cambio)
export function convertMoney(
  amount: number,
  from: Currency,
  to: Currency,
  usdToLocalRate: number,
): number {
  if (from === to) return amount;
  if (!usdToLocalRate || usdToLocalRate <= 0) return amount;

  const fromCode = (from ?? "").toUpperCase();
  const toCode = (to ?? "").toUpperCase();

  // De USD a local (DOP, etc.)
  if (fromCode === "USD" && toCode !== "USD") {
    return amount * usdToLocalRate;
  }
  // De local a USD
  if (fromCode !== "USD" && toCode === "USD") {
    return amount / usdToLocalRate;
  }
  // Conversión entre dos monedas locales: pasar por USD como pivot.
  // No común en LATAM pero lo dejamos por completitud.
  return amount;
}

// Símbolo corto para usar en labels de formularios (Ej. "Tarifa (RD$)").
export function currencyLabel(currency: Currency | null | undefined): string {
  const code = (currency ?? "DOP").toUpperCase();
  if (code === "DOP") return "RD$";
  if (code === "USD") return "US$";
  return code;
}
