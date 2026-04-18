"use client";

import { useEffect, useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Key,
  Copy,
  Check,
  ExternalLink,
  Phone,
  Calendar,
  Home,
  Search,
  MessageCircle,
  Clock,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

type AccessStatus = "pending" | "sent" | "confirmed";

interface KeyEntry {
  bookingId: string;
  propertyId: string;
  propertyName: string;
  propertyAddress: string;
  guest: string;
  phone: string | null;
  phone4: string | null;
  checkIn: string;
  checkOut: string;
  channel: string;
  bookingUrl: string | null;
  accessCode: string;
  status: AccessStatus;
}

const STORAGE_KEY = "stayhost_key_statuses";

function loadStatuses(): Record<string, { status: AccessStatus; code: string }> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStatuses(data: Record<string, { status: AccessStatus; code: string }>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function formatDate(iso: string) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" });
}

function daysUntil(iso: string) {
  const diff = Math.ceil((new Date(iso + "T12:00:00").getTime() - Date.now()) / 86400000);
  return diff;
}

const ChannelBadge = ({ channel }: { channel: string }) => {
  const map: Record<string, { label: string; color: string }> = {
    airbnb: { label: "Airbnb", color: "bg-rose-100 text-rose-700" },
    vrbo: { label: "VRBO", color: "bg-indigo-100 text-indigo-700" },
    booking: { label: "Booking", color: "bg-blue-100 text-blue-700" },
    manual: { label: "Directa", color: "bg-emerald-100 text-emerald-700" },
  };
  const info = map[channel] ?? { label: channel, color: "bg-gray-100 text-gray-700" };
  return (
    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", info.color)}>
      {info.label}
    </span>
  );
};

const StatusBadge = ({ status }: { status: AccessStatus }) => {
  const map: Record<AccessStatus, { label: string; color: string }> = {
    pending: { label: "Pendiente", color: "bg-amber-100 text-amber-700" },
    sent: { label: "Enviado", color: "bg-blue-100 text-blue-700" },
    confirmed: { label: "Confirmado", color: "bg-emerald-100 text-emerald-700" },
  };
  const info = map[status];
  return (
    <span className={cn("text-[11px] font-semibold px-2.5 py-1 rounded-full", info.color)}>
      {info.label}
    </span>
  );
};

export default function KeysPanel() {
  const [entries, setEntries] = useState<KeyEntry[]>([]);
  const [statuses, setStatuses] = useState<Record<string, { status: AccessStatus; code: string }>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | AccessStatus>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState("");

  const fetchBookings = () => {
    setLoading(true);
    try {
      const session = localStorage.getItem("stayhost_session");
      const email = (session ? JSON.parse(session).email : null)
        || localStorage.getItem("stayhost_owner_email");
      if (!email) { setLoading(false); return; }

      const saved = loadStatuses();
      setStatuses(saved);

      fetch(`/api/bookings?email=${encodeURIComponent(email)}`)
        .then(r => r.json())
        .then(data => {
          if (!data.properties?.length) { setLoading(false); return; }
          const all: KeyEntry[] = [];
          for (const prop of data.properties) {
            for (const b of prop.bookings ?? []) {
              // Only show bookings with check-in within next 60 days or check-out in future
              const daysToCheckIn = daysUntil(b.start);
              if (daysToCheckIn < -1 || daysToCheckIn > 60) continue;

              const savedEntry = saved[b.id];
              const suggestedCode = b.phone4 || b.start.replace(/-/g, "").slice(-4);

              all.push({
                bookingId: b.id,
                propertyId: prop.id,
                propertyName: prop.name,
                propertyAddress: prop.address || "",
                guest: b.guest,
                phone: b.phone,
                phone4: b.phone4,
                checkIn: b.start,
                checkOut: b.end,
                channel: b.channel,
                bookingUrl: b.bookingUrl,
                accessCode: savedEntry?.code ?? suggestedCode,
                status: savedEntry?.status ?? "pending",
              });
            }
          }
          all.sort((a, b) => a.checkIn.localeCompare(b.checkIn));
          setEntries(all);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    } catch {
      setLoading(false);
    }
  };

  useEffect(() => { fetchBookings(); }, []);

  const updateEntry = (id: string, status: AccessStatus, code: string) => {
    const updated = { ...statuses, [id]: { status, code } };
    setStatuses(updated);
    saveStatuses(updated);
    setEntries(prev =>
      prev.map(e => e.bookingId === id ? { ...e, status, accessCode: code } : e)
    );
  };

  const copyCode = (id: string, code: string) => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const openWhatsApp = (phone: string | null, guest: string, code: string, property: string, checkIn: string) => {
    const msg = `Hola ${guest}! Tu código de acceso para *${property}* es: *${code}*. Check-in: ${formatDate(checkIn)}. Cualquier duda estoy a tu disposición.`;
    const num = phone?.replace(/\D/g, "") ?? "";
    const url = num
      ? `https://wa.me/${num}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
  };

  const filtered = useMemo(() => {
    return entries.filter(e => {
      const matchFilter = filter === "all" || e.status === filter;
      const matchSearch = !search ||
        e.guest.toLowerCase().includes(search.toLowerCase()) ||
        e.propertyName.toLowerCase().includes(search.toLowerCase());
      return matchFilter && matchSearch;
    });
  }, [entries, filter, search]);

  const stats = useMemo(() => ({
    pending: entries.filter(e => e.status === "pending").length,
    sent: entries.filter(e => e.status === "sent").length,
    confirmed: entries.filter(e => e.status === "confirmed").length,
    total: entries.length,
  }), [entries]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-900">Gestión de Llaves</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Códigos de acceso generados automáticamente desde reservas</p>
        </div>
        <Button variant="outline" size="sm" className="gap-2 rounded-xl" onClick={fetchBookings}>
          <RefreshCw className="h-4 w-4" />
          Actualizar
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Pendientes", value: stats.pending, color: "text-amber-600", bg: "bg-amber-50 border-amber-100" },
          { label: "Enviados", value: stats.sent, color: "text-blue-600", bg: "bg-blue-50 border-blue-100" },
          { label: "Confirmados", value: stats.confirmed, color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-100" },
        ].map(s => (
          <Card key={s.label} className={cn("border", s.bg)}>
            <CardContent className="p-4 flex items-center gap-3">
              <Key className={cn("h-8 w-8", s.color)} />
              <div>
                <p className={cn("text-2xl font-black", s.color)}>{s.value}</p>
                <p className="text-xs text-muted-foreground font-medium">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar huésped o propiedad..."
            className="pl-9 rounded-xl"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          {(["all", "pending", "sent", "confirmed"] as const).map(f => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              className="rounded-xl text-xs"
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "Todos" : f === "pending" ? "Pendientes" : f === "sent" ? "Enviados" : "Confirmados"}
            </Button>
          ))}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground gap-2">
          <RefreshCw className="h-5 w-5 animate-spin" />
          Cargando reservas...
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <Key className="h-12 w-12 text-muted-foreground/40" />
            <p className="font-semibold text-slate-600">No hay reservas próximas</p>
            <p className="text-sm text-muted-foreground">Los códigos aparecen automáticamente cuando sincronizas un iCal</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map(entry => {
            const days = daysUntil(entry.checkIn);
            const isUrgent = days >= 0 && days <= 2;

            return (
              <Card key={entry.bookingId} className={cn(
                "border transition-all",
                isUrgent && entry.status === "pending" && "border-amber-300 bg-amber-50/30"
              )}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Left: Code — click to edit */}
                    <div className="flex-shrink-0 text-center">
                      {editingId === entry.bookingId ? (
                        <div className="w-16 flex flex-col items-center gap-1">
                          <input
                            autoFocus
                            aria-label="Código de acceso"
                            maxLength={6}
                            value={editingCode}
                            onChange={e => setEditingCode(e.target.value.replace(/\D/g, ""))}
                            onKeyDown={e => {
                              if (e.key === "Enter") { updateEntry(entry.bookingId, entry.status, editingCode); setEditingId(null); }
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            onBlur={() => { updateEntry(entry.bookingId, entry.status, editingCode); setEditingId(null); }}
                            className="w-16 h-16 rounded-2xl bg-slate-900 text-white text-center text-xl font-black tracking-widest border-2 border-amber-400 outline-none"
                          />
                          <p className="text-[9px] text-amber-600 font-bold">ENTER</p>
                        </div>
                      ) : (
                        <div
                          className="w-16 h-16 rounded-2xl bg-slate-900 flex flex-col items-center justify-center shadow-lg cursor-pointer hover:bg-slate-700 transition-colors group"
                          title="Click para editar el código"
                          onClick={() => { setEditingId(entry.bookingId); setEditingCode(entry.accessCode); }}
                        >
                          <Key className="h-3 w-3 text-white/40 mb-0.5 group-hover:text-amber-400 transition-colors" />
                          <span className="text-xl font-black text-white tracking-widest">{entry.accessCode}</span>
                        </div>
                      )}
                      <p className="text-[9px] text-muted-foreground mt-1 font-medium">CÓDIGO</p>
                    </div>

                    {/* Center: Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-bold text-slate-900 truncate">{entry.guest}</span>
                        <ChannelBadge channel={entry.channel} />
                        <StatusBadge status={entry.status} />
                        {isUrgent && entry.status === "pending" && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                            <AlertTriangle className="h-3 w-3" />
                            {days === 0 ? "Hoy" : days === 1 ? "Mañana" : `${days}d`}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 text-sm text-muted-foreground mb-1">
                        <Home className="h-3.5 w-3.5" />
                        <span className="font-medium truncate">{entry.propertyName}</span>
                        {entry.propertyAddress && (
                          <span className="text-xs truncate">· {entry.propertyAddress}</span>
                        )}
                      </div>

                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Check-in: <strong className="text-slate-700">{formatDate(entry.checkIn)}</strong>
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Check-out: <strong className="text-slate-700">{formatDate(entry.checkOut)}</strong>
                        </span>
                        {entry.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            <span>{entry.phone}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2.5 rounded-lg gap-1 text-xs"
                          onClick={() => copyCode(entry.bookingId, entry.accessCode)}
                        >
                          {copiedId === entry.bookingId
                            ? <><Check className="h-3.5 w-3.5 text-emerald-600" /> Copiado</>
                            : <><Copy className="h-3.5 w-3.5" /> Copiar</>
                          }
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2.5 rounded-lg gap-1 text-xs text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                          onClick={() => openWhatsApp(entry.phone, entry.guest, entry.accessCode, entry.propertyName, entry.checkIn)}
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                          WhatsApp
                        </Button>

                        {entry.bookingUrl && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2.5 rounded-lg gap-1 text-xs"
                            onClick={() => window.open(entry.bookingUrl!, "_blank")}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Ver reserva
                          </Button>
                        )}
                      </div>

                      {/* Status actions */}
                      <div className="flex gap-1.5 justify-end">
                        {entry.status !== "sent" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 rounded-lg text-[11px] text-blue-700 border-blue-200 hover:bg-blue-50"
                            onClick={() => updateEntry(entry.bookingId, "sent", entry.accessCode)}
                          >
                            Marcar enviado
                          </Button>
                        )}
                        {entry.status !== "confirmed" && (
                          <Button
                            size="sm"
                            className="h-7 px-2 rounded-lg text-[11px] bg-emerald-600 hover:bg-emerald-700"
                            onClick={() => updateEntry(entry.bookingId, "confirmed", entry.accessCode)}
                          >
                            <Check className="h-3 w-3 mr-1" />
                            Confirmar
                          </Button>
                        )}
                        {entry.status !== "pending" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 rounded-lg text-[11px] text-muted-foreground"
                            onClick={() => updateEntry(entry.bookingId, "pending", entry.accessCode)}
                          >
                            Resetear
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
