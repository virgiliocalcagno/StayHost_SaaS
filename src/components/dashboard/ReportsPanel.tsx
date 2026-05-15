"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  DollarSign,
  TrendingUp,
  Calendar,
  Home,
  Users,
  BarChart3,
  Loader2,
  ArrowUpRight,
} from "lucide-react";
import { formatMoney, sumByCurrency } from "@/lib/money/format";
import { useTenantCurrency } from "@/lib/money/useTenantCurrency";

type Booking = {
  id: string;
  guest: string;
  start: string;
  end: string;
  totalPrice: number;
  // Heredada de la propiedad — necesaria para no sumar DOP+USD a ciegas.
  currency: string;
  status: string;
  channel: string;
};

type Property = {
  id: string;
  name: string;
  city: string;
  currency: string;
  bookings: Booking[];
};

export default function ReportsPanel() {
  const { currency: tenantCurrency, usdToLocalRate } = useTenantCurrency();
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/bookings")
      .then((r) => r.json())
      .then((data) => {
        const props = (data.properties ?? []).map((p: Record<string, unknown>) => {
          const propCurrency = String(p.currency ?? "DOP");
          return {
            id: p.id,
            name: p.name,
            city: p.city ?? "",
            currency: propCurrency,
            bookings: ((p.bookings as Record<string, unknown>[]) ?? []).map((b) => ({
              id: b.id,
              guest: b.guest ?? b.guest_name ?? "",
              start: b.start ?? b.check_in ?? "",
              end: b.end ?? b.check_out ?? "",
              totalPrice: Number(b.totalPrice ?? b.total_price ?? 0),
              // El endpoint ya propaga currency en cada booking, pero
              // mantenemos el fallback a la moneda de la propiedad por si
              // un cliente viejo devuelve bookings sin el campo.
              currency: String(b.currency ?? propCurrency),
              status: String(b.status ?? ""),
              channel: String(b.channel ?? b.source ?? "direct"),
            })),
          };
        });
        setProperties(props);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();

  const metrics = useMemo(() => {
    const allBookings = properties.flatMap((p) => p.bookings);
    const active = allBookings.filter((b) => b.status !== "cancelled");

    // Helper local: agrega bookings cross-currency a tenantCurrency.
    // Devuelve { total, hasMixedCurrencies, skipped } igual que sumByCurrency.
    const aggregateBookings = (list: Booking[]) =>
      sumByCurrency(
        list.map((b) => ({ amount: b.totalPrice, currency: b.currency })),
        tenantCurrency,
        usdToLocalRate,
      );

    // Revenue this month
    const monthBookingsList = active.filter((b) => {
      const d = new Date(b.start);
      return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    });
    const monthAgg = aggregateBookings(monthBookingsList);
    const monthRevenue = monthAgg.total;

    // Revenue last month
    const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
    const lastMonthYear = thisMonth === 0 ? thisYear - 1 : thisYear;
    const lastMonthAgg = aggregateBookings(
      active.filter((b) => {
        const d = new Date(b.start);
        return d.getMonth() === lastMonth && d.getFullYear() === lastMonthYear;
      }),
    );
    const lastMonthRevenue = lastMonthAgg.total;

    const revenueChange = lastMonthRevenue > 0
      ? Math.round(((monthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
      : 0;

    // Total bookings this month
    const monthBookings = monthBookingsList.length;

    // Occupancy (30 days)
    const today = new Date();
    const thirtyAgo = new Date(today);
    thirtyAgo.setDate(thirtyAgo.getDate() - 30);
    const totalNights = properties.length * 30;
    let bookedNights = 0;
    for (const b of active) {
      const s = new Date(b.start);
      const e = new Date(b.end);
      const clampS = s < thirtyAgo ? thirtyAgo : s;
      const clampE = e > today ? today : e;
      const nights = Math.max(0, Math.ceil((clampE.getTime() - clampS.getTime()) / 86400000));
      bookedNights += nights;
    }
    const occupancy = totalNights > 0 ? Math.round((bookedNights / totalNights) * 100) : 0;

    // ADR (Average Daily Rate) — usa el monthRevenue ya normalizado a
    // tenantCurrency, así no mezcla noches DOP con USD en la división.
    const adr = bookedNights > 0 ? Math.round(monthRevenue / bookedNights) : 0;

    // Channel distribution
    const channels: Record<string, number> = {};
    for (const b of active) {
      const ch = b.channel || "direct";
      channels[ch] = (channels[ch] ?? 0) + 1;
    }

    // Monthly revenue for chart (last 6 months) — cada barra también
    // normalizada. hasMixed/skipped a nivel chart no se muestra (sería ruido
    // visual); el badge global del KPI ya advierte si hay conversión.
    const monthlyRevenue: { label: string; value: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const m = new Date(thisYear, thisMonth - i, 1);
      const label = m.toLocaleDateString("es-ES", { month: "short" });
      const monthList = active.filter((b) => {
        const d = new Date(b.start);
        return d.getMonth() === m.getMonth() && d.getFullYear() === m.getFullYear();
      });
      monthlyRevenue.push({ label, value: aggregateBookings(monthList).total });
    }

    // Per-property performance — cada propiedad usa su propia moneda en el
    // display (no mezcla con tenantCurrency), así que aquí no hay conversión.
    const propPerformance = properties.map((p) => {
      const pActive = p.bookings.filter((b) => b.status !== "cancelled");
      const pRevenue = pActive
        .filter((b) => {
          const d = new Date(b.start);
          return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
        })
        .reduce((sum, b) => sum + b.totalPrice, 0);
      let pNights = 0;
      for (const b of pActive) {
        const s = new Date(b.start);
        const e = new Date(b.end);
        const clampS = s < thirtyAgo ? thirtyAgo : s;
        const clampE = e > today ? today : e;
        pNights += Math.max(0, Math.ceil((clampE.getTime() - clampS.getTime()) / 86400000));
      }
      const pOcc = Math.round((pNights / 30) * 100);
      return {
        name: p.name,
        revenue: pRevenue,
        currency: p.currency,
        occupancy: pOcc,
        bookings: pActive.length,
      };
    });

    return {
      monthRevenue,
      monthRevenueMixed: monthAgg.hasMixedCurrencies,
      monthRevenueSkipped: monthAgg.skipped,
      revenueChange,
      monthBookings,
      occupancy,
      adr,
      channels,
      monthlyRevenue,
      propPerformance,
      totalBookings: active.length,
    };
  }, [properties, thisMonth, thisYear, tenantCurrency, usdToLocalRate]);

  const maxChartValue = Math.max(...metrics.monthlyRevenue.map((m) => m.value), 1);

  const channelColors: Record<string, string> = {
    airbnb: "bg-rose-500",
    vrbo: "bg-blue-500",
    "booking.com": "bg-indigo-500",
    direct: "bg-emerald-500",
    block: "bg-slate-400",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Reportes</h2>
        <Badge variant="outline" className="text-xs">
          Datos de los últimos 30 días
        </Badge>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground font-medium">
              Ingresos del Mes
              {metrics.monthRevenueSkipped > 0 && (
                <span className="ml-1 text-amber-600" title="Reservas omitidas por falta de tipo de cambio configurado">
                  ({metrics.monthRevenueSkipped} sin FX)
                </span>
              )}
            </p>
            <p
              className="text-2xl font-black mt-1"
              title={
                metrics.monthRevenueMixed
                  ? `Incluye conversión a ${tenantCurrency} usando tasa USD↔local del tenant`
                  : undefined
              }
            >
              {metrics.monthRevenueMixed ? "≈ " : ""}
              {formatMoney(metrics.monthRevenue, tenantCurrency)}
            </p>
            {metrics.revenueChange !== 0 && (
              <p className={`text-xs mt-1 flex items-center gap-0.5 ${metrics.revenueChange > 0 ? "text-emerald-600" : "text-red-500"}`}>
                <ArrowUpRight className={`h-3 w-3 ${metrics.revenueChange < 0 ? "rotate-90" : ""}`} />
                {metrics.revenueChange > 0 ? "+" : ""}{metrics.revenueChange}% vs mes anterior
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground font-medium">Reservas del Mes</p>
            <p className="text-2xl font-black mt-1">{metrics.monthBookings}</p>
            <p className="text-xs text-muted-foreground mt-1">{metrics.totalBookings} totales</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground font-medium">Ocupación</p>
            <p className="text-2xl font-black mt-1">{metrics.occupancy}%</p>
            <Progress value={metrics.occupancy} className="mt-2 h-1.5" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground font-medium">Tarifa Promedio/Noche</p>
            <p className="text-2xl font-black mt-1">{formatMoney(metrics.adr, tenantCurrency)}</p>
            <p className="text-xs text-muted-foreground mt-1">ADR</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Revenue Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              Ingresos Mensuales
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 h-40">
              {metrics.monthlyRevenue.map((m) => (
                <div key={m.label} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] text-muted-foreground font-medium">
                    {m.value > 999
                      ? `${formatMoney(m.value / 1000, tenantCurrency, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}k`
                      : formatMoney(m.value, tenantCurrency)}
                  </span>
                  <div
                    className="w-full rounded-t-md bg-primary/80 min-h-[4px] transition-all"
                    style={{ height: `${Math.max((m.value / maxChartValue) * 120, 4)}px` }}
                  />
                  <span className="text-[10px] text-muted-foreground capitalize">{m.label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Channel Distribution */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Distribución por Canal
            </CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(metrics.channels).length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Sin datos de canales</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(metrics.channels)
                  .sort(([, a], [, b]) => b - a)
                  .map(([channel, count]) => {
                    const pct = Math.round((count / metrics.totalBookings) * 100);
                    return (
                      <div key={channel} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-medium capitalize">{channel}</span>
                          <span className="text-muted-foreground">{count} ({pct}%)</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${channelColors[channel.toLowerCase()] ?? "bg-slate-500"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Per-Property Performance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Home className="h-4 w-4 text-primary" />
            Rendimiento por Propiedad
          </CardTitle>
        </CardHeader>
        <CardContent>
          {metrics.propPerformance.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Agrega tu primera propiedad para ver reportes</p>
          ) : (
            <div className="space-y-4">
              {metrics.propPerformance.map((p) => (
                <div key={p.name} className="flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{p.name}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span className="flex items-center gap-1">
                        <DollarSign className="h-3 w-3" />{formatMoney(p.revenue, p.currency)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />{p.bookings} reservas
                      </span>
                    </div>
                  </div>
                  <div className="w-32 shrink-0">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground">Ocupación</span>
                      <span className="font-semibold">{p.occupancy}%</span>
                    </div>
                    <Progress value={p.occupancy} className="h-1.5" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
