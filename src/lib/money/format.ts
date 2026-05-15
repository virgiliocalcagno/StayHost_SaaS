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

// Suma una lista de montos en monedas posiblemente distintas, convirtiéndolos
// a `target`. Pensado para agregaciones de dashboard (ingresos totales del
// portafolio, ADR cross-property, etc.) donde un tenant puede tener
// propiedades en DOP y USD a la vez.
//
// Política:
//   - Montos cuya moneda coincide con `target`: se suman directo.
//   - Montos que necesitan conversión: si hay `usdToLocalRate` válido, se
//     convierten via `convertMoney`. Si NO hay rate, se OMITEN y se cuentan
//     en `skipped` — meter NaN al dashboard es peor que mostrar un total
//     parcial honesto.
//   - `hasMixedCurrencies` indica si se agregaron montos de >1 moneda; el
//     caller lo usa para mostrar el prefijo "≈" y avisar que hay conversión.
//
// Si querés mostrar el detalle: `{ total, hasMixedCurrencies, skipped }`
// son suficientes para "RD$ 65,200 ≈" + tooltip "incluye US$ convertido"
// + nota "1 propiedad sin tipo de cambio configurado".
//
// Notas:
//   - Para una sola moneda y sin items, devuelve total=0 y hasMixed=false.
//     El caller decide si mostrar "—" cuando total===0 y skipped>0.
//   - No usar para cálculos contables/legales — el FX rate es estático y
//     el target final debería guardar el rate al momento de la transacción.
//     Esto es solo para displays de overview.
export interface SumByCurrencyResult {
  total: number;
  hasMixedCurrencies: boolean;
  skipped: number;
}

export function sumByCurrency(
  items: Array<{ amount: number; currency: Currency | null | undefined }>,
  target: Currency,
  usdToLocalRate: number | undefined,
): SumByCurrencyResult {
  const targetCode = (target ?? "DOP").toUpperCase();
  const currencies = new Set<string>();
  let total = 0;
  let skipped = 0;

  for (const it of items) {
    const value = Number(it.amount);
    if (!Number.isFinite(value) || value === 0) {
      // 0 no aporta y no debería contar como moneda "presente" para mixed.
      continue;
    }
    const code = (it.currency ?? targetCode).toUpperCase();
    currencies.add(code);

    if (code === targetCode) {
      total += value;
      continue;
    }
    // Necesita conversión. Sin rate válido → omitir y reportar.
    if (!usdToLocalRate || usdToLocalRate <= 0) {
      skipped++;
      continue;
    }
    total += convertMoney(value, code, targetCode, usdToLocalRate);
  }

  return {
    total,
    hasMixedCurrencies: currencies.size > 1,
    skipped,
  };
}
