import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// DOP usa "RD$" como prefijo en uso local — Intl lo formatea como "DOP" o
// "RD$" según locale. Forzamos "RD$" para coincidir con cómo lo escriben los
// dueños en Punta Cana.
export function formatCurrency(value: number, currency: string = "USD"): string {
  if (currency === "DOP") {
    return `RD$ ${value.toLocaleString("es-DO", { maximumFractionDigits: 0 })}`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}
