"use client";

import { useEffect, useState } from "react";

// Hook chico para leer la moneda por defecto del tenant desde /api/me.
// Cachea en sessionStorage para no pegarle al endpoint en cada mount.
// Devuelve "DOP" mientras carga (fallback seguro para mercado primario).
//
// Uso típico:
//   const { currency, usdToLocalRate } = useTenantCurrency();
//   formatMoney(amount, currency)
//
// Notas:
// - `usdToLocalRate` puede venir `undefined` para roles staff (filtrado
//   server-side, ver /api/me). Cleaner/maintenance no necesitan FX rate
//   porque no ven márgenes ni totales agregados.
// - Si el endpoint falla, devuelve los defaults sin warning para no romper
//   la UI. La auth real ya falló en otro lado si no hay sesión.

export interface TenantCurrencyInfo {
  currency: string;
  usdToLocalRate: number | undefined;
  loading: boolean;
}

const CACHE_KEY = "stayhost.tenantCurrency.v1";
const CACHE_TTL_MS = 60 * 1000; // 1 min, suficiente para evitar refetch en navegación

interface CachedShape {
  currency: string;
  usdToLocalRate?: number;
  at: number;
}

function readCache(): CachedShape | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedShape;
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(value: CachedShape) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    /* sessionStorage llena o private mode — ignore */
  }
}

export function useTenantCurrency(): TenantCurrencyInfo {
  const cached = readCache();
  const [currency, setCurrency] = useState<string>(cached?.currency ?? "DOP");
  const [usdToLocalRate, setUsdToLocalRate] = useState<number | undefined>(
    cached?.usdToLocalRate,
  );
  const [loading, setLoading] = useState<boolean>(!cached);

  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          defaultCurrency?: string;
          usdToLocalRate?: number;
        };
        if (cancelled) return;
        const c = data.defaultCurrency ?? "DOP";
        const fx = data.usdToLocalRate;
        setCurrency(c);
        setUsdToLocalRate(fx);
        writeCache({ currency: c, usdToLocalRate: fx, at: Date.now() });
      } catch {
        /* network / offline — usar defaults sin warning */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { currency, usdToLocalRate, loading };
}
