"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Building2,
  Calendar,
  DollarSign,
  TrendingUp,
  MessageSquare,
  Star,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";

// ─── Datos reales desde /api/bookings ─────────────────────────────────────────
// Antes: stats/recentBookings/properties eran arrays hardcodeados con valores
// inventados. Ahora jalamos de Supabase vía /api/bookings (que trae props +
// sus reservas en una sola llamada) y /api/checkin (para notificaciones).
// Cálculos:
//   • Ingresos del Mes  → sum(total_price) de bookings con check_in en el mes actual
//   • Reservas Activas  → count de bookings donde check_in ≤ hoy < check_out
//   • Tasa de Ocupación → noches reservadas / noches disponibles (últimos 30 días)
//   • Reservas Recientes → últimas 5 bookings por check_in desc
//   • Rendimiento Props  → % ocupación últimos 30d por propiedad

type BookingRow = {
  id: string;
  guest: string;
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  status: string;
  channel: string;
  totalPrice: number;
};

type PropRow = {
  id: string;
  name: string;
  bookings: BookingRow[];
};

type BookingsResponse = { properties: PropRow[] };

function todayYMD(): string {
  // YYYY-MM-DD en hora local (Virgilio está en CLT, UTC-4). Usar toISOString
  // aquí daría +4h de corrimiento en la noche.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysBetween(aYMD: string, bYMD: string): number {
  // Diff en días calendario (no importa DST porque usamos YMD).
  const [ay, am, ad] = aYMD.split("-").map(Number);
  const [by, bm, bd] = bYMD.split("-").map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function monthKey(ymd: string): string {
  return ymd.slice(0, 7); // YYYY-MM
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

function formatDateRange(startYMD: string, endYMD: string): string {
  const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const [, sm, sd] = startYMD.split("-").map(Number);
  const [, em, ed] = endYMD.split("-").map(Number);
  return `${MESES[sm - 1]} ${sd} - ${MESES[em - 1]} ${ed}`;
}

export default function OverviewPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [properties, setProperties] = useState<PropRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/bookings", { cache: "no-store", credentials: "include" });
        if (!res.ok) {
          // 403 = sin tenant linkeado. No es un crash, sólo un estado vacío.
          if (res.status === 403) {
            if (!cancelled) { setProperties([]); setLoading(false); }
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as BookingsResponse;
        if (!cancelled) {
          setProperties(data.properties ?? []);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const allBookings: BookingRow[] = useMemo(
    () => properties.flatMap((p) => p.bookings),
    [properties]
  );

  // ── Stats agregadas ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const today = todayYMD();
    const thisMonth = monthKey(today);

    const activeNow = allBookings.filter(
      (b) => b.status !== "cancelled" && b.start <= today && b.end > today
    );

    // Ingresos del mes actual — tomamos reservas cuyo check-in cae este mes.
    const thisMonthBookings = allBookings.filter(
      (b) => b.status !== "cancelled" && monthKey(b.start) === thisMonth
    );
    const monthlyRevenue = thisMonthBookings.reduce(
      (sum, b) => sum + (Number(b.totalPrice) || 0),
      0
    );

    // Ingresos mes anterior para comparar (trend up/down).
    const prevMonth = (() => {
      const [y, m] = today.slice(0, 7).split("-").map(Number);
      const prev = new Date(Date.UTC(y, m - 2, 1));
      return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
    })();
    const prevMonthRevenue = allBookings
      .filter((b) => b.status !== "cancelled" && monthKey(b.start) === prevMonth)
      .reduce((sum, b) => sum + (Number(b.totalPrice) || 0), 0);

    const revenueDelta = prevMonthRevenue > 0
      ? Math.round(((monthlyRevenue - prevMonthRevenue) / prevMonthRevenue) * 100)
      : null;

    // Ocupación últimos 30 días.
    const windowStart = (() => {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    })();
    const windowDays = 30;
    const propCount = properties.length || 1;
    const totalAvailableNights = windowDays * propCount;

    const bookedNights = allBookings.reduce((sum, b) => {
      if (b.status === "cancelled") return sum;
      const start = b.start > windowStart ? b.start : windowStart;
      const end = b.end < today ? b.end : today;
      return sum + daysBetween(start, end);
    }, 0);

    const occupancyPct = totalAvailableNights > 0
      ? Math.round((bookedNights / totalAvailableNights) * 100)
      : 0;

    return {
      monthlyRevenue,
      revenueDelta,
      activeCount: activeNow.length,
      occupancyPct,
    };
  }, [allBookings, properties]);

  // ── Reservas recientes (últimas 5 por check_in desc) ────────────────────────
  const recentBookings = useMemo(() => {
    const propById = new Map(properties.map((p) => [p.id, p.name]));
    // /api/bookings ya filtra canceladas pero por si acaso.
    const all = properties.flatMap((p) =>
      p.bookings
        .filter((b) => b.status !== "cancelled" && b.status !== "blocked")
        .map((b) => ({ ...b, propertyName: propById.get(p.id) ?? "—" }))
    );
    return all
      .sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0))
      .slice(0, 5);
  }, [properties]);

  // ── Rendimiento por propiedad (ocupación últimos 30d) ──────────────────────
  const propertyPerf = useMemo(() => {
    const today = todayYMD();
    const d = new Date();
    d.setDate(d.getDate() - 30);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const windowStart = `${y}-${m}-${day}`;
    const windowDays = 30;

    return properties.map((p) => {
      const booked = p.bookings.reduce((sum, b) => {
        if (b.status === "cancelled") return sum;
        const start = b.start > windowStart ? b.start : windowStart;
        const end = b.end < today ? b.end : today;
        return sum + daysBetween(start, end);
      }, 0);
      const occupancy = Math.min(100, Math.round((booked / windowDays) * 100));
      return { id: p.id, name: p.name, occupancy };
    });
  }, [properties]);

  // ── Gráfico de ingresos por mes (últimos 12 meses) ─────────────────────────
  const revenueByMonth = useMemo(() => {
    const now = new Date();
    const months: { label: string; ymKey: string; total: number }[] = [];
    const LETRAS = ["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ymKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      months.push({ label: LETRAS[d.getMonth()], ymKey, total: 0 });
    }
    for (const b of allBookings) {
      if (b.status === "cancelled") continue;
      const k = monthKey(b.start);
      const bucket = months.find((m) => m.ymKey === k);
      if (bucket) bucket.total += Number(b.totalPrice) || 0;
    }
    const max = Math.max(1, ...months.map((m) => m.total));
    return months.map((m) => ({ ...m, heightPct: Math.round((m.total / max) * 100) }));
  }, [allBookings]);

  // ───────────────────────────────────────────────────────────────────────────
  const currencyFmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i}><CardContent className="p-6"><div className="h-20 animate-pulse bg-muted rounded" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-destructive">
          Error cargando datos: {error}
        </CardContent>
      </Card>
    );
  }

  if (properties.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Building2 className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-lg font-medium">Aún no tienes propiedades</p>
          <p className="text-sm text-muted-foreground mt-1">
            Agrega tu primera propiedad en la sección <strong>Propiedades</strong> para ver tu panel de resumen.
          </p>
        </CardContent>
      </Card>
    );
  }

  const statCards = [
    {
      title: "Ingresos del Mes",
      value: currencyFmt.format(stats.monthlyRevenue),
      change: stats.revenueDelta === null ? "—" : `${stats.revenueDelta >= 0 ? "+" : ""}${stats.revenueDelta}%`,
      trend: (stats.revenueDelta ?? 0) >= 0 ? "up" : "down",
      icon: DollarSign,
      color: "text-chart-2",
      bgColor: "bg-chart-2/10",
    },
    {
      title: "Reservas Activas",
      value: String(stats.activeCount),
      change: `${properties.length} propiedades`,
      trend: "up",
      icon: Calendar,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      title: "Tasa de Ocupación",
      value: `${stats.occupancyPct}%`,
      change: "últimos 30d",
      trend: stats.occupancyPct >= 50 ? "up" : "down",
      icon: TrendingUp,
      color: "text-chart-4",
      bgColor: "bg-chart-4/10",
    },
    {
      title: "Próximas Llegadas",
      value: String(
        allBookings.filter((b) => {
          const today = todayYMD();
          const in7 = (() => {
            const d = new Date();
            d.setDate(d.getDate() + 7);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const day = String(d.getDate()).padStart(2, "0");
            return `${y}-${m}-${day}`;
          })();
          return b.status !== "cancelled" && b.start > today && b.start <= in7;
        }).length
      ),
      change: "7 días",
      trend: "up",
      icon: MessageSquare,
      color: "text-chart-3",
      bgColor: "bg-chart-3/10",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.title} className="hover:shadow-soft transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className={`p-3 rounded-xl ${stat.bgColor}`}>
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </div>
                <div className={`flex items-center gap-1 text-sm ${
                  stat.trend === "up" ? "text-chart-2" : "text-chart-4"
                }`}>
                  {stat.trend === "up" ? (
                    <ArrowUpRight className="h-4 w-4" />
                  ) : (
                    <ArrowDownRight className="h-4 w-4" />
                  )}
                  {stat.change}
                </div>
              </div>
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-sm text-muted-foreground">{stat.title}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Bookings */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Reservas Recientes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {recentBookings.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin reservas todavía.</p>
            ) : (
              recentBookings.map((booking) => (
                <div
                  key={booking.id}
                  className="flex items-center gap-4 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                >
                  <Avatar>
                    <AvatarFallback>{initialsOf(booking.guest)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{booking.guest}</p>
                    <p className="text-sm text-muted-foreground truncate">{booking.propertyName}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">
                      {booking.totalPrice > 0 ? currencyFmt.format(booking.totalPrice) : "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateRange(booking.start, booking.end)}
                    </p>
                  </div>
                  <Badge
                    variant={booking.status === "confirmed" ? "default" : "secondary"}
                    className={booking.status === "confirmed" ? "bg-chart-2 text-white" : ""}
                  >
                    {booking.status === "confirmed" ? "Confirmada" : booking.status}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Property Performance */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Rendimiento de Propiedades</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {propertyPerf.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin propiedades.</p>
            ) : (
              propertyPerf.map((property) => (
                <div key={property.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{property.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Star className="h-4 w-4 fill-primary text-primary" />
                      <span className="text-sm font-medium">—</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Progress value={property.occupancy} className="flex-1 h-2" />
                    <span className="text-sm text-muted-foreground w-12">{property.occupancy}%</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Revenue Chart — 12 meses */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Ingresos Mensuales (12m)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-end justify-between gap-2 px-4">
            {revenueByMonth.map((m, i) => (
              <div key={m.ymKey} className="flex-1 flex flex-col items-center gap-2">
                <div
                  title={currencyFmt.format(m.total)}
                  className={`w-full rounded-t-lg transition-all ${
                    i === revenueByMonth.length - 1 ? "gradient-gold" : "bg-primary/20"
                  }`}
                  style={{ height: `${Math.max(4, m.heightPct)}%` }}
                />
                <span className="text-xs text-muted-foreground">{m.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
