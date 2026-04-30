"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  ClipboardList,
  X,
  Check,
  AlertCircle,
  Calendar,
  Phone,
  IdCard,
  Image as ImageIcon,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";

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

interface BookingRequest {
  id: string;
  propertyId: string;
  propertyName: string;
  checkIn: string;
  checkOut: string;
  guestName: string | null;
  guestPhone: string | null;
  guestDoc: string | null;
  guestNationality: string | null;
  docPhotoUrl: string | null;
  numGuests: number | null;
  note: string | null;
  createdAt: string;
  phoneLast4: string | null;
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

  // Solicitudes pendientes desde el Hub público (pending_review).
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [approvePrice, setApprovePrice] = useState<Record<string, string>>({});
  // Modal post-aprobacion: muestra link de pago publico (si el host
  // tiene PayPal habilitado) y sugiere texto de WhatsApp para enviarlo.
  const [approvedInfo, setApprovedInfo] = useState<{
    guestName: string;
    guestPhone: string | null;
    propertyName: string;
    checkIn: string;
    checkOut: string;
    total: number;
    channelCode: string | null;
    payUrl: string | null;
  } | null>(null);

  const loadRequests = useCallback(async () => {
    setRequestsLoading(true);
    try {
      const res = await fetch("/api/bookings/requests", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { requests?: BookingRequest[] };
      setRequests(Array.isArray(data.requests) ? data.requests : []);
    } finally {
      setRequestsLoading(false);
    }
  }, []);

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
    loadRequests();
  }, [loadRequests]);

  const handleApprove = async (req: BookingRequest) => {
    setActionError(null);
    const priceStr = (approvePrice[req.id] ?? "").trim();
    const price = Number(priceStr);
    if (!priceStr || Number.isNaN(price) || price < 0) {
      setActionError(`Cargá un precio válido para "${req.guestName ?? "huésped"}"`);
      return;
    }
    setActingId(req.id);
    try {
      const res = await fetch(`/api/bookings/${req.id}/approve`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totalPrice: price, source: "direct" }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { channelCode?: string; paymentToken?: string };
      // Sacamos la solicitud aprobada de la lista local sin esperar reload.
      setRequests((prev) => prev.filter((r) => r.id !== req.id));
      // Construimos el payUrl si hay paymentToken — la pagina publica
      // de pago se monta solo si el host tiene PayPal configurado, pero
      // el link siempre es valido (cae a "pago no disponible" si no hay).
      const payUrl =
        json.paymentToken && tenantId
          ? `${window.location.origin}/hub/${tenantId}/pay/${json.paymentToken}`
          : null;
      setApprovedInfo({
        guestName: req.guestName ?? "Huésped",
        guestPhone: req.guestPhone,
        propertyName: req.propertyName,
        checkIn: req.checkIn,
        checkOut: req.checkOut,
        total: price,
        channelCode: json.channelCode ?? null,
        payUrl,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (req: BookingRequest) => {
    if (!confirm(`¿Rechazar la solicitud de ${req.guestName ?? "este huésped"}?`)) return;
    setActionError(null);
    setActingId(req.id);
    try {
      // Reusamos PATCH /api/bookings (cambia status a cancelled).
      const res = await fetch("/api/bookings", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: req.id, status: "cancelled" }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setRequests((prev) => prev.filter((r) => r.id !== req.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setActingId(null);
    }
  };

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

      {/* Solicitudes pendientes desde el Hub público */}
      {(requests.length > 0 || requestsLoading) && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-amber-600" />
                <CardTitle className="text-lg">Solicitudes pendientes</CardTitle>
                {!requestsLoading && requests.length > 0 && (
                  <Badge className="bg-amber-600 text-white">{requests.length}</Badge>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={loadRequests}
                disabled={requestsLoading}
              >
                {requestsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Refrescar"}
              </Button>
            </div>
            <CardDescription>
              Reservas solicitadas por huéspedes desde tu Hub público. Revisá la identidad antes de aprobar.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {actionError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <span>{actionError}</span>
              </div>
            )}
            {requestsLoading && requests.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Cargando solicitudes...
              </div>
            ) : (
              requests.map((req) => {
                const nights = Math.max(
                  1,
                  Math.round(
                    (new Date(req.checkOut).getTime() - new Date(req.checkIn).getTime()) / 86400000
                  )
                );
                const isActing = actingId === req.id;
                return (
                  <div
                    key={req.id}
                    className="rounded-xl border border-amber-200 bg-white p-4 grid md:grid-cols-[120px_1fr_auto] gap-4"
                  >
                    {/* Foto del documento */}
                    <div className="md:row-span-2">
                      {req.docPhotoUrl ? (
                        <a
                          href={req.docPhotoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block aspect-[4/3] rounded-lg overflow-hidden border bg-muted relative group"
                          title="Click para ver foto completa"
                        >
                          <img
                            src={req.docPhotoUrl}
                            alt="Documento del huésped"
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <Eye className="h-5 w-5 text-white" />
                          </div>
                        </a>
                      ) : (
                        <div className="aspect-[4/3] rounded-lg border-2 border-dashed border-muted flex items-center justify-center text-muted-foreground">
                          <ImageIcon className="h-6 w-6" />
                        </div>
                      )}
                    </div>

                    {/* Datos del huésped y de la reserva */}
                    <div className="space-y-2 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <h4 className="font-bold text-base truncate">{req.guestName ?? "(sin nombre)"}</h4>
                        <Badge variant="outline" className="text-xs">{req.guestNationality ?? "—"}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground space-y-1">
                        <p className="flex items-center gap-1.5"><Layout className="h-3.5 w-3.5" /> {req.propertyName}</p>
                        <p className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5" />
                          {req.checkIn} → {req.checkOut} ({nights} {nights === 1 ? "noche" : "noches"})
                        </p>
                        <p className="flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5" />
                          {req.numGuests ?? 1} {req.numGuests === 1 ? "huésped" : "huéspedes"}
                        </p>
                        <p className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> {req.guestPhone ?? "—"}</p>
                        <p className="flex items-center gap-1.5"><IdCard className="h-3.5 w-3.5" /> {req.guestDoc ?? "—"}</p>
                        {req.note && (
                          <p className="text-xs italic mt-1 bg-muted/50 p-2 rounded">{req.note}</p>
                        )}
                      </div>
                    </div>

                    {/* Acciones: precio + aprobar/rechazar */}
                    <div className="flex flex-col gap-2 md:items-end md:min-w-[180px]">
                      <div className="space-y-1 w-full md:w-40">
                        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                          Precio total
                        </label>
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={approvePrice[req.id] ?? ""}
                          onChange={(e) =>
                            setApprovePrice((prev) => ({ ...prev, [req.id]: e.target.value }))
                          }
                          placeholder="USD"
                          className="text-right"
                        />
                      </div>
                      <Button
                        size="sm"
                        className="w-full md:w-40 bg-emerald-600 hover:bg-emerald-700 gap-2"
                        onClick={() => handleApprove(req)}
                        disabled={isActing}
                      >
                        {isActing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Aprobar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full md:w-40 text-red-600 border-red-200 hover:bg-red-50 gap-2"
                        onClick={() => handleReject(req)}
                        disabled={isActing}
                      >
                        <X className="h-3.5 w-3.5" /> Rechazar
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      )}

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

      {/* Modal post-aprobación: sugerencia de cobro manual por WhatsApp.
          StayHost no procesa pagos todavía — el host coordina el cobro
          él mismo (transferencia, link PayPal.me, link Stripe individual). */}
      {approvedInfo && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="bg-emerald-100 p-2 rounded-xl">
                  <Check className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">Reserva aprobada</h3>
                  <p className="text-sm text-muted-foreground">
                    {approvedInfo.guestName} · {approvedInfo.propertyName}
                  </p>
                  {approvedInfo.channelCode && (
                    <p className="text-xs font-mono mt-1 text-emerald-700 bg-emerald-50 inline-block px-2 py-0.5 rounded">
                      {approvedInfo.channelCode}
                    </p>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setApprovedInfo(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="p-6 space-y-4">
              {/* Link de pago — copiar y compartir al huésped */}
              {approvedInfo.payUrl && (
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Link de pago para el huésped
                  </p>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={approvedInfo.payUrl}
                      className="flex-1 font-mono text-xs"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => navigator.clipboard.writeText(approvedInfo.payUrl!)}
                      title="Copiar link"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Si tenés PayPal habilitado en Configuración, el huésped paga directo desde ese link.
                    Si no, podés coordinar el cobro manualmente.
                  </p>
                </div>
              )}

              {approvedInfo.guestPhone ? (
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Mensaje sugerido para WhatsApp
                  </p>
                  <textarea
                    readOnly
                    rows={6}
                    className="w-full text-sm p-3 border rounded-xl bg-slate-50 font-mono"
                    value={`Hola ${approvedInfo.guestName}! 👋\n\nTu reserva en ${approvedInfo.propertyName} fue aprobada:\n📅 ${approvedInfo.checkIn} → ${approvedInfo.checkOut}\n💰 Total: $${approvedInfo.total}\n${approvedInfo.channelCode ? `🔑 Código: ${approvedInfo.channelCode}\n` : ""}${approvedInfo.payUrl ? `\nPagá tu reserva acá: ${approvedInfo.payUrl}\n` : ""}`}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                      asChild
                    >
                      <a
                        href={`https://wa.me/${approvedInfo.guestPhone.replace(/\D/g, "")}?text=${encodeURIComponent(
                          `Hola ${approvedInfo.guestName}! Tu reserva en ${approvedInfo.propertyName} (${approvedInfo.checkIn} → ${approvedInfo.checkOut}) fue aprobada. Total: $${approvedInfo.total}.${approvedInfo.channelCode ? ` Código: ${approvedInfo.channelCode}.` : ""}${approvedInfo.payUrl ? ` Pagá acá: ${approvedInfo.payUrl}` : ""}`
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Phone className="h-3.5 w-3.5 mr-1.5" />
                        Abrir WhatsApp
                      </a>
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  El huésped no dejó teléfono — contactalo por otro medio.
                </p>
              )}
            </div>

            <div className="p-4 border-t flex justify-end">
              <Button onClick={() => setApprovedInfo(null)}>Listo</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
