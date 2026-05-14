import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

import { formatMoney } from "@/lib/money/format";

// Compat shim: callers viejos llamaban formatCurrency(value) o
// formatCurrency(value, "DOP"). El helper canónico es formatMoney en
// @/lib/money/format con (amount, currency) requeridos. Este wrapper deja
// currency opcional con default DOP (Punta Cana es DOP-mayoritario), pero
// nuevo código DEBE usar formatMoney y pasar currency explícito.
export function formatCurrency(value: number | string | null | undefined, currency: string = "DOP"): string {
  return formatMoney(value, currency);
}
