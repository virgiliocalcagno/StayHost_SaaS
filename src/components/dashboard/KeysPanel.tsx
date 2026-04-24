"use client";

/**
 * KeysPanel — vista orientada a reservas de los códigos de acceso.
 *
 * Lee en paralelo:
 *   - /api/bookings  → reservas futuras + info TTLock de cada propiedad
 *   - /api/access-pins → PINs ya guardados en DB
 *
 * Cruza por `booking_id` y muestra:
 *   - Si la reserva YA tiene un PIN guardado → ese código + delivery_status.
 *   - Si no tiene → un código sugerido (últimos 4 del teléfono o de la fecha)
 *     hasta que el usuario lo marque como enviado o edite, momento en que
 *     se hace upsert en access_pins y — si la propiedad tiene TTLock — se
 *     programa en la cerradura.
 *
 * Ya NO usa localStorage. Todo vive en Supabase via /api/access-pins y es
 * la misma fuente de datos que ve el tab "Llaves & PINs" en Dispositivos.
 */

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
  Lock,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type DeliveryStatus = "pending" | "sent" | "confirmed";

interface BookingLite {
  id: string;
  propertyId: string;
  propertyName: string;
  propertyAddress: string;
  ttlockAccountId: string | null;
  ttlockLockId: string | null;
  guest: string;
  phone: string | null;
  phone4: string | null;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  channel: string;
  bookingUrl: string | null;
}

interface PinRow {
  id: string;
  booking_id: string | null;
  property_id: string;
  pin: string;
  delivery_status: DeliveryStatus;
  status: "active" | "expired" | "revoked";
  ttlock_pwd_id: string | null;
  valid_from: string;
  valid_to: string;
  sync_status?: SyncStatus | null;
  sync_last_error?: string | null;
  sync_next_retry_at?: string | null;
  sync_attempts?: number | null;
}

type SyncStatus = "pending" | "syncing" | "synced" | "retry" | "failed" | "offline_lock";

interface Entry extends BookingLite {
  pinId: string | null; // null si todavía no se persistió
  accessCode: string;
  deliveryStatus: DeliveryStatus;
  hasTtlock: boolean;
  syncStatus: SyncStatus | null;
  syncLastError: string | null;
  syncNextRetryAt: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  // YYYY-MM-DD: agregamos hora fija al mediodía para que `new Date()` no
  // aplique un offset de timezone y nos corra al día anterior en AST.
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("es", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function daysUntil(iso: string) {
  return Math.ceil(
    (new Date(iso + "T12:00:00").getTime() - Date.now()) / 86400000
  );
}

/**
 * Construye el instante (ISO UTC) en que empieza la ventana de validez.
 * Convención: check-in a las 15:00 hora local del navegador (Santo Domingo
 * AST) el día `checkIn`.
 */
function checkInStartIso(checkIn: string): string {
  const [y, m, d] = checkIn.split("-").map(Number);
  // Date constructor con year/month/day/hour/minute usa hora local.
  const local = new Date(y, (m ?? 1) - 1, d ?? 1, 15, 0, 0, 0);
  return local.toISOString();
}

/**
 * Instante de fin de la ventana. Convención: check-out a las 11:00 local.
 */
function checkOutEndIso(checkOut: string): string {
  const [y, m, d] = checkOut.split("-").map(Number);
  const local = new Date(y, (m ?? 1) - 1, d ?? 1, 11, 0, 0, 0);
  return local.toISOString();
}

function suggestCode(b: { phone4: string | null; checkIn: string }): string {
  if (b.phone4 && b.phone4.length === 4) return b.phone4;
  return b.checkIn.replace(/-/g, "").slice(-4);
}

// ─── Badges ─────────────────────────────────────────────────────────────────

const ChannelBadge = ({ channel }: { channel: string }) => {
  const map: Record<string, { label: string; color: string }> = {
    airbnb: { label: "Airbnb", color: "bg-rose-100 text-rose-700" },
    vrbo: { label: "VRBO", color: "bg-indigo-100 text-indigo-700" },
    booking: { label: "Booking", color: "bg-blue-100 text-blue-700" },
    manual: { label: "Directa", color: "bg-emerald-100 text-emerald-700" },
    direct: { label: "Directa", color: "bg-emerald-100 text-emerald-700" },
  };
  const info = map[channel] ?? { label: channel, color: "bg-gray-100 text-gray-700" };
  return (
    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", info.color)}>
      {info.label}
    </span>
  );
};

const StatusBadge = ({ status }: { status: DeliveryStatus }) => {
  const map: Record<DeliveryStatus, { label: string; color: string }> = {
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

/**
 * Badge del estado de sync con TTLock. Refleja si el PIN que vive en BD
 * ya esta programado en la cerradura fisica. Tooltip muestra detalle.
 */
const SyncBadge = ({ status, error }: { status: SyncStatus | null; error: string | null }) => {
  if (!status) return null;
  const map: Record<SyncStatus, { label: string; color: string; title: string }> = {
    pending:      { label: "En cola",      color: "bg-slate-100 text-slate-700", title: "Esperando primer intento de sync con la cerradura" },
    syncing:      { label: "Sincronizando", color: "bg-sky-100 text-sky-700",    title: "Enviando el PIN a la cerradura…" },
    synced:       { label: "En cerradura", color: "bg-emerald-100 text-emerald-700", title: "Confirmado en la cerradura TTLock" },
    retry:        { label: "Reintentando", color: "bg-amber-100 text-amber-700", title: error ?? "Reintentará en unos minutos" },
    offline_lock: { label: "Cerradura offline", color: "bg-orange-100 text-orange-700", title: "La cerradura no responde. Reintenta cada 10 min." },
    failed:       { label: "Error — reintentar", color: "bg-rose-100 text-rose-700", title: error ?? "Agotó los reintentos. Revisá la cuenta TTLock o la cerradura." },
  };
  const info = map[status];
  return (
    <span
      className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full", info.color)}
      title={info.title}
    >
      {info.label}
    </span>
  );
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function KeysPanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | DeliveryStatus>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [bookingsRes, pinsRes] = await Promise.all([
        fetch("/api/bookings", { credentials: "include", cache: "no-store" }),
        fetch("/api/access-pins", { credentials: "include", cache: "no-store" }),
      ]);
      if (!bookingsRes.ok) {
        setEntries([]);
        setLoading(false);
        return;
      }
      const bookingsData = await bookingsRes.json();
      const pinsData = pinsRes.ok
        ? ((await pinsRes.json()) as { pins: PinRow[] })
        : { pins: [] };

      // Index: bookingId → PIN más reciente (GET ya viene ordenado por created_at desc).
      const pinsByBooking = new Map<string, PinRow>();
      for (const p of pinsData.pins ?? []) {
        if (p.booking_id && !pinsByBooking.has(p.booking_id)) {
          pinsByBooking.set(p.booking_id, p);
        }
      }

      const all: Entry[] = [];
      for (const prop of bookingsData.properties ?? []) {
        for (const b of prop.bookings ?? []) {
          // Saltar check-outs pasados.
          if (daysUntil(b.end) < 0) continue;

          const pin = pinsByBooking.get(b.id);
          const hasTtlock = Boolean(prop.ttlockAccountId && prop.ttlockLockId);

          all.push({
            id: b.id,
            propertyId: prop.id,
            propertyName: prop.name,
            propertyAddress: prop.address || "",
            ttlockAccountId: prop.ttlockAccountId ?? null,
            ttlockLockId: prop.ttlockLockId ?? null,
            guest: b.guest,
            phone: b.phone,
            phone4: b.phone4,
            checkIn: b.start,
            checkOut: b.end,
            channel: b.channel,
            bookingUrl: b.bookingUrl,
            pinId: pin?.id ?? null,
            accessCode: pin?.pin ?? suggestCode({ phone4: b.phone4, checkIn: b.start }),
            deliveryStatus: pin?.delivery_status ?? "pending",
            hasTtlock,
            syncStatus: (pin?.sync_status as SyncStatus | undefined) ?? null,
            syncLastError: pin?.sync_last_error ?? null,
            syncNextRetryAt: pin?.sync_next_retry_at ?? null,
          });
        }
      }
      all.sort((a, b) => a.checkIn.localeCompare(b.checkIn));
      setEntries(all);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Programa el PIN en la cerradura TTLock. Silencioso — solo devuelve el
  // keyboardPwdId si todo salió bien, o null si falló. Los errores no
  // bloquean el guardado del PIN en DB, solo quedan como warning en UI.
  const programOnLock = async (entry: Entry, code: string): Promise<string | null> => {
    if (!false /* programLock: lo hace el backend auto-sync ahora */) return null;
    try {
      const res = await fetch("/api/ttlock/accounts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createPin",
          accountId: entry.ttlockAccountId,
          lockId: entry.ttlockLockId,
          pin: code,
          name: entry.guest,
          startDate: new Date(checkInStartIso(entry.checkIn)).getTime(),
          endDate: new Date(checkOutEndIso(entry.checkOut)).getTime(),
        }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { keyboardPwdId?: string | number };
      return data.keyboardPwdId != null ? String(data.keyboardPwdId) : null;
    } catch {
      return null;
    }
  };

  // Upsert el PIN en DB: POST si todavía no existe, PATCH si ya existe.
  // Si `programLock` es true y la propiedad tiene TTLock, también graba el
  // código en la cerradura (y guarda el keyboardPwdId resultante).
  const upsertPin = async (
    entry: Entry,
    code: string,
    deliveryStatus: DeliveryStatus,
    programLock: boolean
  ): Promise<{ pinId: string; ttlockPwdId: string | null } | null> => {
    const ttlockPwdId = programLock ? await programOnLock(entry, code) : null;

    if (entry.pinId) {
      // PATCH existente.
      const patchBody: Record<string, unknown> = {
        id: entry.pinId,
        pin: code,
        delivery_status: deliveryStatus,
      };
      if (programLock && ttlockPwdId) patchBody.ttlock_pwd_id = ttlockPwdId;

      const res = await fetch("/api/access-pins", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patchBody),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setErrorMsg(err.error || "No se pudo actualizar el PIN");
        return null;
      }
      return { pinId: entry.pinId, ttlockPwdId };
    } else {
      // POST nuevo.
      const sourceByChannel: Record<string, string> = {
        airbnb: "airbnb_ical",
        vrbo: "vrbo_ical",
        direct: "direct_booking",
        manual: "manual",
      };
      const source = sourceByChannel[entry.channel] ?? "manual";

      const res = await fetch("/api/access-pins", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: entry.propertyId,
          bookingId: entry.id,
          guestName: entry.guest,
          guestPhone: entry.phone || undefined,
          pin: code,
          source,
          validFrom: checkInStartIso(entry.checkIn),
          validTo: checkOutEndIso(entry.checkOut),
          deliveryStatus,
          ttlockLockId: entry.ttlockLockId || undefined,
          ttlockPwdId: ttlockPwdId || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setErrorMsg(err.error || "No se pudo crear el PIN");
        return null;
      }
      const data = (await res.json()) as { id: string };
      return { pinId: data.id, ttlockPwdId };
    }
  };

  // Handler principal: edita código y/o cambia estado.
  const saveEntry = async (
    entry: Entry,
    code: string,
    deliveryStatus: DeliveryStatus,
    programLock: boolean
  ) => {
    setSavingId(entry.id);
    setErrorMsg(null);
    const result = await upsertPin(entry, code, deliveryStatus, programLock);
    setSavingId(null);
    if (!result) return;

    setEntries((prev) =>
      prev.map((e) =>
        e.id === entry.id
          ? { ...e, accessCode: code, deliveryStatus, pinId: result.pinId }
          : e
      )
    );
  };

  const copyCode = (id: string, code: string) => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const openWhatsApp = (entry: Entry) => {
    const msg = `Hola ${entry.guest}! Tu código de acceso para *${entry.propertyName}* es: *${entry.accessCode}*. Check-in: ${formatDate(entry.checkIn)}. Cualquier duda estoy a tu disposición.`;
    const num = entry.phone?.replace(/\D/g, "") ?? "";
    const url = num
      ? `https://wa.me/${num}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");

    // Al enviar por WhatsApp, marcamos como "enviado" y — si tiene TTLock —
    // programamos el PIN en la cerradura para que el código funcione.
    if (entry.deliveryStatus === "pending") {
      void saveEntry(entry, entry.accessCode, "sent", false /* programLock: lo hace el backend auto-sync ahora */);
    }
  };

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      const matchFilter = filter === "all" || e.deliveryStatus === filter;
      const matchSearch =
        !search ||
        e.guest.toLowerCase().includes(search.toLowerCase()) ||
        e.propertyName.toLowerCase().includes(search.toLowerCase());
      return matchFilter && matchSearch;
    });
  }, [entries, filter, search]);

  const stats = useMemo(
    () => ({
      pending: entries.filter((e) => e.deliveryStatus === "pending").length,
      sent: entries.filter((e) => e.deliveryStatus === "sent").length,
      confirmed: entries.filter((e) => e.deliveryStatus === "confirmed").length,
      total: entries.length,
    }),
    [entries]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-900">Gestión de Llaves</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Códigos de acceso por reserva — sincronizados con las cerraduras
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 rounded-xl"
          onClick={fetchData}
        >
          <RefreshCw className="h-4 w-4" />
          Actualizar
        </Button>
      </div>

      {errorMsg && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-3 text-sm text-red-700 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{errorMsg}</span>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Pendientes", value: stats.pending, color: "text-amber-600", bg: "bg-amber-50 border-amber-100" },
          { label: "Enviados", value: stats.sent, color: "text-blue-600", bg: "bg-blue-50 border-blue-100" },
          { label: "Confirmados", value: stats.confirmed, color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-100" },
        ].map((s) => (
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
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          {(["all", "pending", "sent", "confirmed"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              className="rounded-xl text-xs"
              onClick={() => setFilter(f)}
            >
              {f === "all"
                ? "Todos"
                : f === "pending"
                  ? "Pendientes"
                  : f === "sent"
                    ? "Enviados"
                    : "Confirmados"}
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
            <p className="text-sm text-muted-foreground">
              Los códigos aparecen automáticamente cuando sincronizas un iCal
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((entry) => {
            const days = daysUntil(entry.checkIn);
            const isUrgent = days >= 0 && days <= 2;
            const saving = savingId === entry.id;

            return (
              <Card
                key={entry.id}
                className={cn(
                  "border transition-all",
                  isUrgent && entry.deliveryStatus === "pending" && "border-amber-300 bg-amber-50/30"
                )}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Left: Code — click to edit */}
                    <div className="flex-shrink-0 text-center">
                      {editingId === entry.id ? (
                        <div className="w-16 flex flex-col items-center gap-1">
                          <input
                            autoFocus
                            aria-label="Código de acceso"
                            maxLength={8}
                            value={editingCode}
                            onChange={(e) =>
                              setEditingCode(e.target.value.replace(/\D/g, ""))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                if (editingCode.length >= 4) {
                                  void saveEntry(entry, editingCode, entry.deliveryStatus, false /* programLock: lo hace el backend auto-sync ahora */);
                                }
                                setEditingId(null);
                              }
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            onBlur={() => {
                              if (
                                editingCode.length >= 4 &&
                                editingCode !== entry.accessCode
                              ) {
                                void saveEntry(entry, editingCode, entry.deliveryStatus, false /* programLock: lo hace el backend auto-sync ahora */);
                              }
                              setEditingId(null);
                            }}
                            className="w-16 h-16 rounded-2xl bg-slate-900 text-white text-center text-xl font-black tracking-widest border-2 border-amber-400 outline-none"
                          />
                          <p className="text-[9px] text-amber-600 font-bold">ENTER</p>
                        </div>
                      ) : (
                        <div
                          className="w-16 h-16 rounded-2xl bg-slate-900 flex flex-col items-center justify-center shadow-lg cursor-pointer hover:bg-slate-700 transition-colors group relative"
                          title={
                            entry.pinId
                              ? "Código guardado. Click para editar."
                              : "Código sugerido. Click para editar y guardar."
                          }
                          onClick={() => {
                            setEditingId(entry.id);
                            setEditingCode(entry.accessCode);
                          }}
                        >
                          <Key className="h-3 w-3 text-white/40 mb-0.5 group-hover:text-amber-400 transition-colors" />
                          <span className="text-xl font-black text-white tracking-widest">
                            {entry.accessCode}
                          </span>
                          {saving && (
                            <div className="absolute inset-0 rounded-2xl bg-slate-900/70 flex items-center justify-center">
                              <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
                            </div>
                          )}
                        </div>
                      )}
                      <p className="text-[9px] text-muted-foreground mt-1 font-medium">
                        {entry.pinId ? "GUARDADO" : "SUGERIDO"}
                      </p>
                    </div>

                    {/* Center: Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-bold text-slate-900 truncate">
                          {entry.guest}
                        </span>
                        <ChannelBadge channel={entry.channel} />
                        <StatusBadge status={entry.deliveryStatus} />
                        {entry.hasTtlock && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full">
                            <Lock className="h-3 w-3" />
                            TTLock
                          </span>
                        )}
                        {entry.hasTtlock && entry.pinId && (
                          <SyncBadge status={entry.syncStatus} error={entry.syncLastError} />
                        )}
                        {isUrgent && entry.deliveryStatus === "pending" && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                            <AlertTriangle className="h-3 w-3" />
                            {days === 0 ? "Hoy" : days === 1 ? "Mañana" : `${days}d`}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1 text-sm text-muted-foreground mb-1">
                        <Home className="h-3.5 w-3.5" />
                        <span className="font-medium truncate">
                          {entry.propertyName}
                        </span>
                        {entry.propertyAddress && (
                          <span className="text-xs truncate">
                            · {entry.propertyAddress}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Check-in:{" "}
                          <strong className="text-slate-700">
                            {formatDate(entry.checkIn)}
                          </strong>
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Check-out:{" "}
                          <strong className="text-slate-700">
                            {formatDate(entry.checkOut)}
                          </strong>
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
                          onClick={() => copyCode(entry.id, entry.accessCode)}
                        >
                          {copiedId === entry.id ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-emerald-600" /> Copiado
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" /> Copiar
                            </>
                          )}
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2.5 rounded-lg gap-1 text-xs text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                          onClick={() => openWhatsApp(entry)}
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                          WhatsApp
                        </Button>

                        {entry.bookingUrl && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2.5 rounded-lg gap-1 text-xs"
                            onClick={() =>
                              window.open(entry.bookingUrl!, "_blank")
                            }
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Ver reserva
                          </Button>
                        )}
                      </div>

                      {/* Status actions */}
                      <div className="flex gap-1.5 justify-end">
                        {entry.deliveryStatus !== "sent" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={saving}
                            className="h-7 px-2 rounded-lg text-[11px] text-blue-700 border-blue-200 hover:bg-blue-50"
                            onClick={() =>
                              saveEntry(entry, entry.accessCode, "sent", false /* programLock: lo hace el backend auto-sync ahora */)
                            }
                          >
                            Marcar enviado
                          </Button>
                        )}
                        {entry.deliveryStatus !== "confirmed" && (
                          <Button
                            size="sm"
                            disabled={saving}
                            className="h-7 px-2 rounded-lg text-[11px] bg-emerald-600 hover:bg-emerald-700"
                            onClick={() =>
                              saveEntry(entry, entry.accessCode, "confirmed", false /* programLock: lo hace el backend auto-sync ahora */)
                            }
                          >
                            <Check className="h-3 w-3 mr-1" />
                            Confirmar
                          </Button>
                        )}
                        {entry.deliveryStatus !== "pending" && entry.pinId && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={saving}
                            className="h-7 px-2 rounded-lg text-[11px] text-muted-foreground"
                            onClick={() =>
                              saveEntry(entry, entry.accessCode, "pending", false)
                            }
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
