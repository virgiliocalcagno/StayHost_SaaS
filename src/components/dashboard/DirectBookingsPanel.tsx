"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Globe,
  ExternalLink,
  Copy,
  Palette,
  Layout,
  CreditCard,
  Users,
  TrendingUp,
  Eye,
  Settings,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { useState, useEffect } from "react";

interface PropertyLite {
  id: string;
  name: string;
}

interface BookingLite {
  start: string;
  end: string;
  status: string;
  channel: string;
  totalPrice: number;
}

const INDIRECT_CHANNELS = new Set(["airbnb", "vrbo", "booking", "expedia", "ical", "ical_manual", "block"]);

const formatCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export default function DirectBookingsPanel() {
  const [origin, setOrigin] = useState("");
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [properties, setProperties] = useState<PropertyLite[]>([]);
  const [directCount, setDirectCount] = useState(0);
  const [directRevenue, setDirectRevenue] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setOrigin(window.location.origin);

    const fetchAll = async () => {
      try {
        const [meRes, propsRes, bookingsRes] = await Promise.all([
          fetch("/api/me", { credentials: "same-origin" }).then(r => r.json()).catch(() => null),
          fetch("/api/properties", { credentials: "same-origin" }).then(r => r.json()).catch(() => null),
          fetch("/api/bookings", { credentials: "same-origin" }).then(r => r.json()).catch(() => null),
        ]);

        setTenantId(meRes?.tenantId ?? null);

        const propList = Array.isArray(propsRes?.properties) ? propsRes.properties : [];
        setProperties(propList.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })));

        const propsWithBookings = Array.isArray(bookingsRes?.properties) ? bookingsRes.properties : [];
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        let count = 0;
        let revenue = 0;
        for (const prop of propsWithBookings) {
          const bookings: BookingLite[] = Array.isArray(prop.bookings) ? prop.bookings : [];
          for (const b of bookings) {
            if (b.status === "cancelled" || b.status === "blocked") continue;
            if (INDIRECT_CHANNELS.has(b.channel)) continue;
            if (b.start < monthStart) continue;
            count += 1;
            revenue += Number(b.totalPrice ?? 0);
          }
        }
        setDirectCount(count);
        setDirectRevenue(revenue);
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, []);

  // El hub público hoy resuelve cualquier string en /hub/[hostId]. Hasta que
  // exista columna tenants.slug, usamos el tenantId. Es feo pero estable y
  // no leakea entre tenants.
  const hostId = tenantId ?? "";
  const hubUrl = hostId ? `${origin}/hub/${hostId}` : "";

  const copyToClipboard = () => {
    if (hubUrl) navigator.clipboard.writeText(hubUrl);
  };

  const stats = [
    {
      label: "Reservas directas (mes)",
      value: loading ? "—" : String(directCount),
      icon: Users,
      hint: directCount === 0 && !loading ? "Sin reservas aún" : null,
    },
    {
      label: "Ingresos directos (mes)",
      value: loading ? "—" : formatCurrency(directRevenue),
      icon: CreditCard,
      hint: directRevenue === 0 && !loading ? "Sin ingresos aún" : null,
    },
    {
      label: "Visitas al sitio",
      value: "—",
      icon: Eye,
      hint: "Próximamente",
    },
    {
      label: "Tasa de conversión",
      value: "—",
      icon: TrendingUp,
      hint: "Próximamente",
    },
  ];

  const websiteSettings = [
    { name: "URL del Hub", status: hostId ? "active" : "pending", value: hostId ? `/hub/${hostId}` : "Configurando..." },
    { name: "SSL/HTTPS", status: "active", value: "Activo (Vercel)" },
    { name: "Propiedades publicadas", status: properties.length > 0 ? "active" : "pending", value: `${properties.length} ${properties.length === 1 ? "propiedad" : "propiedades"}` },
    { name: "Google Analytics", status: "pending", value: "Próximamente" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Reservas Directas</h2>
          <p className="text-muted-foreground">Gestiona tu sitio web de reservas y aumenta tus ingresos</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" className="gap-2" disabled={!hubUrl} asChild={!!hubUrl}>
            {hubUrl ? (
              <a href={hubUrl} target="_blank" rel="noopener noreferrer">
                <Eye className="h-4 w-4" />
                Vista previa
              </a>
            ) : (
              <span>
                <Eye className="h-4 w-4" />
                Vista previa
              </span>
            )}
          </Button>
          <Button className="gradient-gold text-primary-foreground gap-2">
            <Settings className="h-4 w-4" />
            Personalizar
          </Button>
        </div>
      </div>

      {/* Website URL */}
      <Card className="bg-gradient-to-r from-primary/5 to-chart-2/5 border-primary/20">
        <CardContent className="p-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="p-3 rounded-xl bg-primary/10">
              <Globe className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">Tu sitio web de reservas</h3>
              <p className="text-sm text-muted-foreground">Comparte este enlace con tus huéspedes</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input value={loading ? "Cargando..." : hubUrl} readOnly className="flex-1 bg-background" />
            <Button variant="outline" size="icon" onClick={copyToClipboard} disabled={!hubUrl}>
              <Copy className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" disabled={!hubUrl} asChild={!!hubUrl}>
              {hubUrl ? (
                <a href={hubUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              ) : (
                <span><ExternalLink className="h-4 w-4" /></span>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 rounded-xl bg-primary/10">
                <stat.icon className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold">{stat.value}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  {stat.hint && (
                    <Badge variant="secondary" className="text-xs">{stat.hint}</Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Booking Pages */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Páginas de Reserva</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Cargando propiedades...
                </div>
              ) : properties.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">Aún no tenés propiedades publicadas</p>
                  <p className="text-sm text-muted-foreground mb-4">Creá una propiedad en el panel de Propiedades para que aparezca en tu sitio de reservas.</p>
                </div>
              ) : (
                <>
                  {properties.map((prop) => {
                    const propUrl = `${origin}/hub/${hostId}/${prop.id}`;
                    return (
                      <div key={prop.id} className="flex items-center gap-4 p-4 rounded-lg bg-muted/50">
                        <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center">
                          <Layout className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold truncate">{prop.name}</h4>
                          <p className="text-sm text-muted-foreground truncate">/hub/{hostId}/{prop.id}</p>
                        </div>
                        <Button variant="outline" size="sm" asChild>
                          <a href={propUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4 mr-1" />Ver
                          </a>
                        </Button>
                      </div>
                    );
                  })}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Website Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Configuración del Sitio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {websiteSettings.map((setting) => (
              <div key={setting.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-3 min-w-0">
                  <CheckCircle2 className={`h-5 w-5 flex-shrink-0 ${setting.status === "active" ? "text-chart-2" : "text-muted-foreground"}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{setting.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{setting.value}</p>
                  </div>
                </div>
                <Badge variant={setting.status === "active" ? "default" : "secondary"} className={setting.status === "active" ? "bg-chart-2" : ""}>
                  {setting.status === "active" ? "Activo" : "Pendiente"}
                </Badge>
              </div>
            ))}

            <div className="pt-4 border-t space-y-3">
              <Button variant="outline" className="w-full gap-2">
                <Palette className="h-4 w-4" />
                Personalizar diseño
              </Button>
              <Button variant="outline" className="w-full gap-2">
                <CreditCard className="h-4 w-4" />
                Configurar pagos
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
