"use client";

/**
 * Check-ins Panel — StayHost Dashboard
 *
 * Auto-generation sources:
 *   • stayhost_direct_bookings  (confirmed reservations with phone → last4)
 *   • stayhost_ical_configs     (each config has cached bookings[] with phoneLast4 from iCal)
 *
 * Persistence: records live in Postgres (`public.checkin_records`) — not in
 * localStorage — so that every logged-in device sees the same list and the
 * guest check-in flow works across serverless invocations. The panel talks to
 * `/api/checkin` for create / list / update / delete / upsertBatch.
 *
 * Self-contained links: we still base64-encode the booking payload into the
 * URL `?d=` param so guests on their phones don't need to hit the server for
 * the welcome screen. The record in Postgres is the source of truth for state
 * transitions (ID validation, electricity payment, access granted).
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  LogIn, Plus, Copy, Check, Eye, EyeOff, Wifi, Zap, ShieldCheck, ShieldX,
  RefreshCw, Trash2, ExternalLink, User, Calendar, Building2, Phone,
  CheckCircle2, Clock, XCircle, AlertTriangle, QrCode, Download,
  Sparkles, Globe, Repeat, Search, MessageCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LocalCheckIn {
  id: string;
  source: "auto_ical" | "auto_direct" | "manual";
  channel?: string;          // airbnb | vrbo | booking | direct
  guestName: string;
  guestLastName: string;
  lastFourDigits: string;    // door code + auth token
  checkin: string;
  checkout: string;
  nights: number;
  propertyId: string;
  propertyName: string;
  propertyAddress?: string;
  propertyImage?: string;
  wifiSsid?: string;
  wifiPassword?: string;
  electricityEnabled: boolean;
  electricityTotal: number;
  idStatus: "pending" | "uploaded" | "validated" | "rejected";
  electricityPaid: boolean;
  accessGranted: boolean;
  status: "pendiente" | "validado";
  missingData?: boolean;
  createdAt: string;
  bookingRef?: string;       // id in stayhost_direct_bookings or iCal UID
  encodedData: string;       // base64 for URL ?d=
  link: string;              // full check-in URL
}

interface WifiConfig {
  propertyId: string;
  propertyName: string;
  ssid: string;
  password: string;
}

/** Per-property electricity & rate config */
interface ElecConfig {
  propertyId: string;
  enabled: boolean;  // charge electricity for this property?
  rate: number;      // USD per night (default 5)
  paypal: boolean;   // include PayPal commission?
}

interface DirectBooking {
  id: string;
  guestName: string;
  guestPhone?: string;
  checkin: string;
  checkout: string;
  propertyId?: string;
  propertyName?: string;
  status: string;
}

interface ICalBooking {
  uid: string;
  guestName: string;
  checkin: string;
  checkout: string;
  nights: number;
  phoneLast4?: string;
  channel: string;
}

interface ICalConfig {
  id: string;
  propertyId: string;
  channel: string;
  bookings?: ICalBooking[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  return `${d} ${months[+m - 1]} ${y}`;
}

function diffNights(a: string, b: string) {
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000));
}

function calcElectricity(nights: number, rate = 5, paypal = true) {
  const sub = nights * rate;
  return paypal ? parseFloat((sub / 0.943).toFixed(2)) : sub;
}

/** Encode booking data into base64 for self-contained URL */
function encodeData(data: Record<string, unknown>): string {
  try { return btoa(unescape(encodeURIComponent(JSON.stringify(data)))); }
  catch { return ""; }
}

function buildLink(id: string, encoded: string): string {
  if (typeof window === "undefined") return `/checkin/${id}`;
  return `${window.location.origin}/checkin/${id}?d=${encoded}`;
}

function qrUrl(data: string, size = 180) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}&bgcolor=ffffff&color=1a1a2e&margin=8`;
}

function makeId() {
  return `ci-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ─── API helpers ──────────────────────────────────────────────────────────────
//
// Shape returned by /api/checkin. Close to LocalCheckIn but with server-only
// fields (idPhotoPath) and without client-only ones (encodedData, link),
// which we derive from the other fields after fetching.

interface ApiCheckin {
  id: string;
  guestName: string;
  guestLastName: string;
  lastFourDigits: string;
  checkin: string;
  checkout: string;
  nights: number;
  propertyId: string;
  propertyName: string;
  propertyAddress?: string;
  propertyImage?: string;
  wifiSsid?: string;
  wifiPassword?: string;
  electricityEnabled: boolean;
  electricityRate: number;
  electricityPaid: boolean;
  electricityTotal: number;
  paypalFeeIncluded: boolean;
  idStatus: "pending" | "uploaded" | "validated" | "rejected";
  accessGranted: boolean;
  status: "pendiente" | "validado";
  bookingRef?: string;
  source: "manual" | "auto_direct" | "auto_ical";
  channel?: string;
  missingData: boolean;
  createdAt: string;
  updatedAt: string;
  idPhotoPath?: string;
}

async function apiCheckin<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("/api/checkin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `API error ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * Build the full LocalCheckIn (what the panel renders) from the API record.
 * The encoded URL payload and link are derived here instead of being stored.
 */
function fromApi(
  r: ApiCheckin,
  upsellsByProperty: (propertyId: string) => { id: string; n: string; p: number; d: string }[]
): LocalCheckIn {
  const upsells = upsellsByProperty(r.propertyId);
  const encoded = r.missingData ? "" : encodeData({
    n: r.guestName,
    l: r.guestLastName,
    d4: r.lastFourDigits,
    ci: r.checkin,
    co: r.checkout,
    nt: r.nights,
    p: r.propertyName,
    pa: r.propertyAddress,
    pi: r.propertyImage,
    ws: r.wifiSsid,
    wp: r.wifiPassword,
    ee: r.electricityEnabled,
    et: r.electricityTotal,
    br: r.bookingRef,
    ...(upsells.length > 0 ? { us: upsells } : {}),
  });
  const link = r.missingData ? "" : buildLink(r.id, encoded);
  return {
    id: r.id,
    source: r.source,
    channel: r.channel,
    guestName: r.guestName,
    guestLastName: r.guestLastName,
    lastFourDigits: r.lastFourDigits,
    checkin: r.checkin,
    checkout: r.checkout,
    nights: r.nights,
    propertyId: r.propertyId,
    propertyName: r.propertyName,
    propertyAddress: r.propertyAddress,
    propertyImage: r.propertyImage,
    wifiSsid: r.wifiSsid,
    wifiPassword: r.wifiPassword,
    electricityEnabled: r.electricityEnabled,
    electricityTotal: r.electricityTotal,
    idStatus: r.idStatus,
    electricityPaid: r.electricityPaid,
    accessGranted: r.accessGranted,
    status: r.status,
    missingData: r.missingData,
    createdAt: r.createdAt,
    bookingRef: r.bookingRef,
    encodedData: encoded,
    link,
  };
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ r }: { r: LocalCheckIn }) {
  if (r.missingData) return <Badge className="bg-orange-500/20 text-orange-600 border-orange-500/30"><AlertTriangle className="w-3 h-3 mr-1" />Faltan Datos</Badge>;
  if (r.accessGranted) return <Badge className="bg-emerald-500/20 text-emerald-600 border-emerald-500/30"><CheckCircle2 className="w-3 h-3 mr-1" />Validado</Badge>;
  if (r.idStatus === "rejected") return <Badge className="bg-red-500/20 text-red-600 border-red-500/30"><XCircle className="w-3 h-3 mr-1" />Rechazado</Badge>;
  if (r.idStatus === "uploaded") return <Badge className="bg-amber-500/20 text-amber-600 border-amber-500/30"><Eye className="w-3 h-3 mr-1" />ID Pendiente</Badge>;
  return <Badge variant="outline" className="text-muted-foreground"><Clock className="w-3 h-3 mr-1" />Pendiente</Badge>;
}

function SourceBadge({ r }: { r: LocalCheckIn }) {
  if (r.source === "auto_ical") {
    const c = r.channel ?? "ical";
    const colors: Record<string, string> = { airbnb: "bg-rose-100 text-rose-700", vrbo: "bg-blue-100 text-blue-700", booking: "bg-indigo-100 text-indigo-700" };
    return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize ${colors[c] ?? "bg-muted text-muted-foreground"}`}><Globe className="inline w-2.5 h-2.5 mr-0.5" />{c}</span>;
  }
  if (r.source === "auto_direct") return <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-violet-100 text-violet-700"><Globe className="inline w-2.5 h-2.5 mr-0.5" />Directa</span>;
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-muted text-muted-foreground">Manual</span>;
}

// ─── Pipeline Steps ───────────────────────────────────────────────────────────

function PipelineSteps({ r }: { r: LocalCheckIn }) {
  const steps = [
    { label: "Enlace", done: true, active: !r.accessGranted, failed: false, skip: false },
    { label: "ID", done: r.idStatus === "validated", active: r.idStatus === "uploaded", failed: r.idStatus === "rejected", skip: false },
    { label: "Pago", done: r.electricityPaid, active: r.electricityEnabled && !r.electricityPaid, failed: false, skip: !r.electricityEnabled },
    { label: "Acceso", done: r.accessGranted, active: false, failed: false, skip: false },
  ];
  return (
    <div className="flex items-center gap-0">
      {steps.map((s, i) => (
        <React.Fragment key={s.label}>
          <div className="flex flex-col items-center gap-0.5">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-white
              ${s.failed ? "bg-red-500" : s.done ? "bg-emerald-500" : s.active ? "bg-amber-400" : s.skip ? "bg-muted opacity-40" : "bg-muted"}`}>
              {s.failed ? <XCircle className="w-3 h-3"/> : s.done ? <Check className="w-3 h-3"/> : <div className="w-1.5 h-1.5 rounded-full bg-white/60"/>}
            </div>
            <span className={`text-[9px] font-medium ${s.done ? "text-emerald-600" : s.active ? "text-amber-600" : "text-muted-foreground"}`}>{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-0.5 w-8 -mt-3 ${steps[i+1].done || steps[i+1].active ? "bg-emerald-300" : "bg-muted"}`}/>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Electricity Config Form ──────────────────────────────────────────────────

interface ElecConfigFormProps {
  properties: { id: string; name: string }[];
  existing: ElecConfig[];
  onSave: (cfg: ElecConfig) => void;
}

function ElecConfigForm({ properties, existing, onSave }: ElecConfigFormProps) {
  const [form, setForm] = useState({ propertyId: "", enabled: true, rate: 5, paypal: true } as ElecConfig);

  function handlePropertyChange(id: string) {
    const ex = existing.find(c => c.propertyId === id);
    setForm(ex ? { ...ex } : { propertyId: id, enabled: true, rate: 5, paypal: true });
  }

  return (
    <div className="space-y-3 border-t pt-3">
      <p className="text-xs font-medium text-muted-foreground uppercase">Agregar / Actualizar</p>
      {properties.length > 0 ? (
        <select
          value={form.propertyId}
          onChange={e => handlePropertyChange(e.target.value)}
          className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          aria-label="Propiedad para electricidad">
          <option value="">Seleccionar propiedad...</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      ) : (
        <Input
          value={form.propertyId}
          onChange={e => setForm(f => ({ ...f, propertyId: e.target.value }))}
          placeholder="ID de propiedad" />
      )}

      <div className="flex items-center justify-between p-3 border rounded-lg">
        <p className="text-sm font-medium">Cobrar electricidad</p>
        <button
          type="button"
          onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}
          className={`w-10 h-6 rounded-full transition-colors ${form.enabled ? "bg-amber-500" : "bg-muted"}`}
          aria-label={form.enabled ? "Desactivar" : "Activar"}>
          <div className={`w-4 h-4 rounded-full bg-white mx-auto transition-transform ${form.enabled ? "translate-x-2" : "-translate-x-2"}`} />
        </button>
      </div>

      {form.enabled && (
        <>
          <div className="space-y-1.5">
            <Label>Tarifa (USD por noche)</Label>
            <Input
              type="number" min={1} step={0.5}
              value={form.rate}
              onChange={e => setForm(f => ({ ...f, rate: parseFloat(e.target.value) || 5 }))}
              placeholder="5" />
          </div>
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <div>
              <p className="text-sm font-medium">Incluir comisión PayPal</p>
              <p className="text-xs text-muted-foreground">5.7% absorbido por el huésped</p>
            </div>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, paypal: !f.paypal }))}
              className={`w-10 h-6 rounded-full transition-colors ${form.paypal ? "bg-blue-500" : "bg-muted"}`}
              aria-label={form.paypal ? "Quitar comisión PayPal" : "Incluir comisión PayPal"}>
              <div className={`w-4 h-4 rounded-full bg-white mx-auto transition-transform ${form.paypal ? "translate-x-2" : "-translate-x-2"}`} />
            </button>
          </div>
          {form.rate > 0 && (
            <p className="text-xs text-amber-600">
              Ejemplo 3 noches: ${calcElectricity(3, form.rate, form.paypal).toFixed(2)} USD
              {form.paypal ? ` (tú recibes $${(3 * form.rate).toFixed(2)} netos)` : ""}
            </p>
          )}
        </>
      )}

      <Button
        onClick={() => { if (form.propertyId) { onSave(form); setForm({ propertyId: "", enabled: true, rate: 5, paypal: true }); } }}
        disabled={!form.propertyId}
        variant="outline" className="w-full">
        <Zap className="h-4 w-4 mr-2 text-amber-500" />Guardar Configuración
      </Button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CheckInsPanel() {
  const [records, setRecords] = useState([] as LocalCheckIn[]);
  const [wifiConfigs, setWifiConfigs] = useState([] as WifiConfig[]);
  const [elecConfigs, setElecConfigs] = useState([] as ElecConfig[]);
  const [properties, setProperties] = useState([] as { id: string; name: string; address?: string; image?: string }[]);
  const [copiedId, setCopiedId] = useState(null as string | null);
  const [viewQrRecord, setViewQrRecord] = useState(null as LocalCheckIn | null);
  const [syncing, setSyncing] = useState(false);
  const [syncStats, setSyncStats] = useState({ direct: 0, ical: 0 });
  const [showWifiPass, setShowWifiPass] = useState({} as Record<string, boolean>);

  // Search & filter
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all" as "all" | "today" | "review" | "granted" | "pending");

  // WiFi form
  const [wifiForm, setWifiForm] = useState({ propertyId: "", propertyName: "", ssid: "", password: "" });

  // Create form
  const [form, setForm] = useState({
    guestName: "", guestLastName: "", lastFourDigits: "",
    checkin: "", checkout: "", propertyId: "", propertyName: "",
    propertyAddress: "", wifiSsid: "", wifiPassword: "",
    electricityEnabled: true, paypalFeeIncluded: true, electricityRate: 5,
  });
  const [createError, setCreateError] = useState("");

  // Helper: look up upsells for a property from localStorage (still a client-only concept).
  const upsellsByProperty = useCallback((propertyId: string) => {
    try {
      const raw = localStorage.getItem("stayhost_upsells");
      if (!raw) return [];
      return (JSON.parse(raw) as Array<{ id: string; name: string; price: number; description?: string; active?: boolean; isGlobal?: boolean; propertyId?: string }>)
        .filter(u => u.active !== false && (u.isGlobal || u.propertyId === propertyId))
        .slice(0, 6)
        .map(u => ({ id: u.id, n: u.name, p: u.price, d: u.description ?? "" }));
    } catch {
      return [];
    }
  }, []);

  // Centralised refresh: fetch records from the backend and derive the panel
  // shape. Called on mount and after every mutation.
  const refreshRecords = useCallback(async () => {
    try {
      const { records: api } = await apiCheckin<{ records: ApiCheckin[] }>("list");
      setRecords(api.map(r => fromApi(r, upsellsByProperty)));
    } catch (err) {
      console.error("[CheckInsPanel] list failed:", err);
    }
  }, [upsellsByProperty]);

  // ─── Load ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    void refreshRecords();
    // WiFi, electricity and properties are still per-browser config; only the
    // check-in records themselves moved to the backend.
    try {
      const w = localStorage.getItem("stayhost_wifi_configs");
      if (w) setWifiConfigs(JSON.parse(w));
    } catch {}
    try {
      const e = localStorage.getItem("stayhost_elec_config");
      if (e) setElecConfigs(JSON.parse(e));
    } catch {}
    try {
      const p = localStorage.getItem("stayhost_properties");
      if (p) setProperties(JSON.parse(p).map((x: {id:string;name:string;address?:string;image?:string}) => ({ id:x.id, name:x.name, address:x.address, image:x.image })));
    } catch {}
  }, [refreshRecords]);

  // ─── Build a candidate record for the backend upsert ─────────────────────
  // We build the *payload* for `upsertBatch` (raw fields, no link/encoded).
  // The server persists these; the panel then fetches them back via
  // `refreshRecords` and derives `link`/`encodedData`. That keeps us from
  // having two sources of truth.

  type CandidateFields = {
    source: LocalCheckIn["source"];
    channel?: string;
    guestName: string;
    guestLastName: string;
    lastFourDigits: string;
    checkin: string;
    checkout: string;
    nights: number;
    propertyId: string;
    propertyName: string;
    propertyAddress?: string;
    propertyImage?: string;
    wifiSsid?: string;
    wifiPassword?: string;
    electricityEnabled: boolean;
    electricityTotal: number;
    bookingRef?: string;
    missingData?: boolean;
  };

  const buildCandidate = useCallback((fields: CandidateFields, existingId?: string) => {
    return {
      id: existingId ?? makeId(),
      source: fields.source,
      channel: fields.channel,
      guestName: fields.guestName,
      guestLastName: fields.guestLastName,
      lastFourDigits: fields.lastFourDigits,
      checkin: fields.checkin,
      checkout: fields.checkout,
      nights: fields.nights,
      propertyId: fields.propertyId,
      propertyName: fields.propertyName,
      propertyAddress: fields.propertyAddress,
      propertyImage: fields.propertyImage,
      wifiSsid: fields.wifiSsid,
      wifiPassword: fields.wifiPassword,
      electricityEnabled: fields.electricityEnabled,
      electricityTotal: fields.electricityTotal,
      bookingRef: fields.bookingRef,
      missingData: fields.missingData ?? false,
    };
  }, []);

  // ─── Auto-sync ───────────────────────────────────────────────────────────────
  //
  // Reads pending direct/iCal bookings from localStorage, builds candidate
  // records, and pushes the NEW ones (those whose bookingRef isn't already in
  // the backend) as a single `upsertBatch` request. Keeping the
  // bookingRef-based dedup on the client avoids the backend needing to know
  // about direct_bookings / ical_configs storage conventions.

  // Lock para prevenir corridas concurrentes de autoSync (desde el effect,
  // el boton, o cualquier otra ruta). Si ya hay una en curso, la segunda
  // no hace nada — evita double-insert bajo cualquier circunstancia.
  const syncInFlight = useRef(false);

  const autoSync = useCallback(async (quiet = false) => {
    if (syncInFlight.current) return { directCount: 0, icalCount: 0 };
    syncInFlight.current = true;
    if (!quiet) setSyncing(true);

    try {
      // Load current backend records so we know which bookingRefs are already synced.
      const { records: apiRecords } = await apiCheckin<{ records: ApiCheckin[] }>("list");
      const usedRefs = new Set(apiRecords.map(r => r.bookingRef).filter(Boolean) as string[]);

      const candidates: ReturnType<typeof buildCandidate>[] = [];

      // Helper: get per-property elec config (with fallback defaults)
      const getElecConfig = (propertyId: string, savedConfigs: ElecConfig[]) => {
        const ec = savedConfigs.find(c => c.propertyId === propertyId);
        return ec ?? { enabled: true, rate: 5, paypal: true };
      };

      let freshElecConfigs: ElecConfig[] = [];
      try {
        const raw = localStorage.getItem("stayhost_elec_config");
        if (raw) freshElecConfigs = JSON.parse(raw);
      } catch {}

      // ── Source 1: direct bookings ──────────────────────────────────────────
      let directCount = 0;
      try {
        const raw = localStorage.getItem("stayhost_direct_bookings");
        const bookings: DirectBooking[] = raw ? JSON.parse(raw) : [];
        const wifi = JSON.parse(localStorage.getItem("stayhost_wifi_configs") ?? "[]") as WifiConfig[];

        for (const b of bookings) {
          if (b.status !== "confirmed") continue;
          if (usedRefs.has(b.id)) continue;

          const phone = b.guestPhone ?? "";
          const last4 = phone.replace(/\D/g, "").slice(-4);
          if (last4.length !== 4) continue;

          const nights = diffNights(b.checkin, b.checkout);
          if (nights <= 0) continue;

          const nameParts = b.guestName.trim().split(" ");
          const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : b.guestName;
          const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : "";

          const w = wifi.find(x => x.propertyId === b.propertyId);
          const ec = getElecConfig(b.propertyId ?? "", freshElecConfigs);
          const elec = ec.enabled ? calcElectricity(nights, ec.rate, ec.paypal) : 0;
          const prop = properties.find(p => p.id === b.propertyId);

          candidates.push(buildCandidate({
            source: "auto_direct", channel: "direct",
            guestName: firstName || b.guestName, guestLastName: lastName,
            lastFourDigits: last4,
            checkin: b.checkin, checkout: b.checkout, nights,
            propertyId: b.propertyId ?? "", propertyName: b.propertyName ?? "",
            propertyAddress: prop?.address, propertyImage: prop?.image,
            wifiSsid: w?.ssid, wifiPassword: w?.password,
            electricityEnabled: ec.enabled, electricityTotal: elec,
            bookingRef: b.id,
          }));
          usedRefs.add(b.id);
          directCount++;
        }
      } catch {}

      // ── Source 2: iCal cached bookings ─────────────────────────────────────
      let icalCount = 0;
      try {
        const raw = localStorage.getItem("stayhost_ical_configs");
        const configs: ICalConfig[] = raw ? JSON.parse(raw) : [];
        const wifi = JSON.parse(localStorage.getItem("stayhost_wifi_configs") ?? "[]") as WifiConfig[];

        for (const config of configs) {
          if (!config.bookings?.length) continue;
          const w = wifi.find(x => x.propertyId === config.propertyId);
          const propInfo = properties.find(p => p.id === config.propertyId);
          const ec = getElecConfig(config.propertyId, freshElecConfigs);

          for (const b of config.bookings) {
            const isMissingPhone = !b.phoneLast4 || b.phoneLast4.length !== 4;
            const refKey = `ical-${b.uid}`;
            if (usedRefs.has(refKey)) continue;

            const nights = b.nights > 0 ? b.nights : diffNights(b.checkin, b.checkout);
            if (nights <= 0) continue;

            const nameParts = b.guestName.trim().split(" ");
            const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : (isMissingPhone ? "" : b.guestName);
            const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : (isMissingPhone ? b.guestName : "");
            const isMissingName = !firstName || !lastName;
            const missingData = isMissingPhone || isMissingName;

            const elec = ec.enabled ? calcElectricity(nights, ec.rate, ec.paypal) : 0;

            candidates.push(buildCandidate({
              source: "auto_ical", channel: b.channel,
              guestName: missingData ? "Pendiente" : (firstName || b.guestName),
              guestLastName: missingData ? "de Datos" : (lastName ?? ""),
              lastFourDigits: isMissingPhone ? "0000" : (b.phoneLast4 ?? "0000"),
              checkin: b.checkin, checkout: b.checkout, nights,
              propertyId: config.propertyId, propertyName: propInfo?.name ?? config.propertyId,
              propertyAddress: propInfo?.address, propertyImage: propInfo?.image,
              missingData: missingData,
              wifiSsid: w?.ssid, wifiPassword: w?.password,
              electricityEnabled: ec.enabled, electricityTotal: elec,
              bookingRef: refKey,
            }));
            usedRefs.add(refKey);
            icalCount++;
          }
        }
      } catch {}

      // ── Source 3: bookings en BD (via /api/bookings) ──────────────────────
      // La fuente de verdad está en Postgres, no en localStorage. Esta fuente
      // cubre el caso donde el iCal se importó antes de que este panel se
      // abriera (los datos viven en bookings pero no en stayhost_ical_configs).
      let dbCount = 0;
      try {
        const res = await fetch("/api/bookings", { cache: "no-store" });
        if (res.ok) {
          const { properties: propsWithBookings } = await res.json() as {
            properties: Array<{
              id: string; name: string; address: string; channel: string;
              bookings: Array<{
                id: string; guest: string; phone: string | null; phone4: string | null;
                start: string; end: string; status: string; channel: string;
                bookingUrl: string | null; channelCode: string | null; phoneLast4: string | null;
                sourceUid: string | null;
              }>;
            }>;
          };
          const wifi = JSON.parse(localStorage.getItem("stayhost_wifi_configs") ?? "[]") as WifiConfig[];

          // Dedupe reforzado: además de usedRefs, construimos un índice por
          // (propertyId + start + end) desde los apiRecords. Cubre el caso
          // donde Source 2 (legacy ical-localStorage) creó el record con
          // bookingRef = "ical-<uid>" y ahora Source 3 lo revisita con la
          // UUID de bookings. El ref no matchea pero las fechas sí → skip.
          const existingByPropDates = new Set(
            apiRecords
              .filter(r => r.propertyId && r.checkin && r.checkout)
              .map(r => `${r.propertyId}|${r.checkin}|${r.checkout}`)
          );

          for (const prop of propsWithBookings ?? []) {
            const w = wifi.find(x => x.propertyId === prop.id);
            const propInfo = properties.find(p => p.id === prop.id);
            const ec = getElecConfig(prop.id, freshElecConfigs);

            for (const b of prop.bookings ?? []) {
              if (b.status !== "confirmed") continue;

              // Dedupe por UUID directo (Source 3 previa)
              if (usedRefs.has(b.id)) continue;

              // Dedupe por ref legacy "ical-<uid>" (Source 2 previa)
              if (b.sourceUid && usedRefs.has(`ical-${b.sourceUid}`)) continue;

              // Dedupe por fechas+propiedad (cubre otros formatos de ref)
              if (existingByPropDates.has(`${prop.id}|${b.start}|${b.end}`)) continue;

              // Preferimos phone_last4 del iCal (Airbnb) si existe; sino de
              // guest_phone. Sin 4 dígitos no podemos sincronizar (el wizard
              // actual los requiere como auth).
              const last4 = b.phoneLast4 || b.phone4 || "";
              const isMissingPhone = last4.length !== 4;

              const nights = diffNights(b.start, b.end);
              if (nights <= 0) continue;

              const nameParts = (b.guest || "").trim().split(/\s+/);
              const firstName = nameParts[0] ?? "";
              const lastNameFromGuest = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";
              // Para Airbnb nunca viene el apellido (SUMMARY = "Reserved").
              // Usamos el channel_code como pseudo-apellido INTERNO: el auth
              // del backend sigue siendo (lastName + last4) pero el huesped
              // nunca lo escribe — el /checkin landing lo valida con codigo
              // +4digitos y redirige con el flag v=2 que skip-ea la pantalla
              // de login. Para legacy links sin v=2 el flujo sigue igual.
              const channelCode = b.channelCode ?? null;
              const lastNameForAuth =
                lastNameFromGuest ||
                (channelCode ? channelCode : "");  // fallback al codigo
              const isMissingName = !lastNameForAuth;
              const missingData = isMissingPhone || isMissingName;

              const elec = ec.enabled ? calcElectricity(nights, ec.rate, ec.paypal) : 0;
              const sourceKind: "auto_ical" | "auto_direct" =
                b.channel === "direct" || b.channel === "manual" ? "auto_direct" : "auto_ical";

              candidates.push(buildCandidate({
                source: sourceKind,
                channel: (b.channel as "airbnb" | "vrbo" | "booking" | "direct") ?? "direct",
                guestName: firstName || b.guest || "Huésped",
                guestLastName: lastNameForAuth,  // apellido real o code
                lastFourDigits: isMissingPhone ? "0000" : last4,
                checkin: b.start, checkout: b.end, nights,
                propertyId: prop.id, propertyName: propInfo?.name ?? prop.name,
                propertyAddress: propInfo?.address, propertyImage: propInfo?.image,
                missingData,
                wifiSsid: w?.ssid, wifiPassword: w?.password,
                electricityEnabled: ec.enabled, electricityTotal: elec,
                bookingRef: b.id,        // UUID de bookings → sincroniza 1:1
              }));
              usedRefs.add(b.id);
              dbCount++;
            }
          }
        }
      } catch (err) {
        console.warn("[CheckInsPanel] bookings sync skipped:", err);
      }

      if (candidates.length > 0) {
        await apiCheckin("upsertBatch", { records: candidates });
        await refreshRecords();
      } else {
        // Even with no new candidates, refresh so the UI matches the server.
        setRecords(apiRecords.map(r => fromApi(r, upsellsByProperty)));
      }

      setSyncStats(s => ({
        direct: s.direct + directCount,
        ical: s.ical + icalCount + dbCount,
      }));
      return { directCount, icalCount: icalCount + dbCount };
    } catch (err) {
      console.error("[CheckInsPanel] autoSync failed:", err);
      return { directCount: 0, icalCount: 0 };
    } finally {
      if (!quiet) setSyncing(false);
      syncInFlight.current = false;
    }
  }, [buildCandidate, properties, refreshRecords, upsellsByProperty]);

  // Run auto-sync on mount (quiet). OJO: el efecto se disparaba en cada
  // cambio de `properties` (que arranca [] y luego se completa con la API),
  // ejecutando autoSync 2 veces en paralelo y metiendo duplicados en la BD.
  // Ahora corre una sola vez cuando properties está cargado y usamos un
  // ref-guard para evitar re-entradas.
  const hasAutoSynced = useRef(false);
  useEffect(() => {
    if (hasAutoSynced.current) return;
    if (properties.length === 0) return;  // esperar a que las props carguen
    hasAutoSynced.current = true;
    void autoSync(true);
  }, [properties, autoSync]);

  // ─── Manual create ──────────────────────────────────────────────────────────

  async function handleCreate() {
    const nights = diffNights(form.checkin, form.checkout);
    if (!form.guestName || !form.guestLastName || form.lastFourDigits.length !== 4 || !form.checkin || !form.checkout) {
      setCreateError("Completa todos los campos requeridos (incluyendo exactamente 4 dígitos).");
      return;
    }
    if (nights <= 0) { setCreateError("Check-out debe ser posterior al check-in."); return; }

    const wifi = wifiConfigs.find(w => w.propertyId === form.propertyId);
    const prop = properties.find(p => p.id === form.propertyId);
    const elec = form.electricityEnabled ? calcElectricity(nights, form.electricityRate, form.paypalFeeIncluded) : 0;

    try {
      await apiCheckin("create", {
        source: "manual",
        guestName: form.guestName,
        guestLastName: form.guestLastName,
        lastFourDigits: form.lastFourDigits,
        checkin: form.checkin,
        checkout: form.checkout,
        nights,
        propertyId: form.propertyId,
        propertyName: form.propertyName || form.propertyId,
        propertyAddress: form.propertyAddress || prop?.address,
        propertyImage: prop?.image,
        wifiSsid: wifi?.ssid ?? form.wifiSsid,
        wifiPassword: wifi?.password ?? form.wifiPassword,
        electricityEnabled: form.electricityEnabled,
        electricityRate: form.electricityRate,
        paypalFeeIncluded: form.paypalFeeIncluded,
        electricityTotal: elec,
      });
      await refreshRecords();
      setForm(f => ({ ...f, guestName: "", guestLastName: "", lastFourDigits: "", checkin: "", checkout: "", propertyId: "", propertyName: "" }));
      setCreateError("");
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "No se pudo crear el check-in");
    }
  }

  // ─── Update status (validate ID, pay electricity, etc.) ──────────────────
  //
  // The backend has dedicated actions for ID validation (`validateId`,
  // `rejectId`) and for marking electricity as paid (`payElectricity`, which
  // also flips accessGranted in one transaction). Anything else goes through
  // the generic `update`.

  async function updateRecord(id: string, patch: Partial<LocalCheckIn>) {
    try {
      if (patch.idStatus === "validated") {
        await apiCheckin("validateId", { id });
      } else if (patch.idStatus === "rejected") {
        await apiCheckin("rejectId", { id });
      } else if (patch.electricityPaid === true) {
        // The guest flow uses /api/checkin `payElectricity` (soft token). The
        // staff equivalent is a plain `update` — RLS ensures we only touch our
        // own tenant's rows.
        await apiCheckin("update", { id, electricityPaid: true });
        // After marking electricity paid, re-trigger the validateId path if
        // the ID was already validated — that's what grants access.
        const current = records.find(r => r.id === id);
        if (current?.idStatus === "validated") {
          await apiCheckin("validateId", { id });
        }
      } else {
        await apiCheckin("update", { id, ...patch });
      }
      await refreshRecords();
    } catch (err) {
      console.error("[CheckInsPanel] updateRecord failed:", err);
    }
  }

  async function deleteRecord(id: string) {
    try {
      await apiCheckin("delete", { id });
      await refreshRecords();
    } catch (err) {
      console.error("[CheckInsPanel] deleteRecord failed:", err);
    }
  }

  // ─── Copy link ────────────────────────────────────────────────────────────

  function copyLink(r: LocalCheckIn) {
    const url = r.link || buildLink(r.id, r.encodedData);
    navigator.clipboard.writeText(url).catch(() => {});
    setCopiedId(r.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  // Compartir check-in por WhatsApp. Arma el mensaje con la URL genérica
  // v2 (código pre-rellenado) y abre WhatsApp — si tenemos el número
  // completo va directo al chat, sino abre el share nativo (Web Share API)
  // o copia al portapapeles como fallback.
  function shareWhatsApp(r: LocalCheckIn) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const channelCode = r.bookingRef ?? "";
    const genericUrl = channelCode
      ? `${origin}/checkin?code=${encodeURIComponent(channelCode)}`
      : `${origin}/checkin`;

    const lines = [
      `¡Hola${r.guestName ? ` ${r.guestName}` : ""}! 👋`,
      ``,
      `Te doy la bienvenida a *${r.propertyName}*.`,
      ``,
      `Para hacer tu check-in online, entrá a:`,
      genericUrl,
      ``,
      channelCode ? `Tu código de reserva ya viene cargado en el link.` : `Usá el código de reserva que recibiste por email.`,
      `Vas a necesitar los últimos 4 dígitos de tu teléfono.`,
      ``,
      `¡Cualquier duda, me avisás!`,
    ];
    const text = lines.join("\n");

    // Intento 1: Web Share API (iOS Safari / Android Chrome) — abre el
    // sheet nativo donde el host elige WhatsApp del contacto.
    type NavigatorWithShare = Navigator & { share?: (data: ShareData) => Promise<void> };
    const nav = navigator as NavigatorWithShare;
    if (typeof window !== "undefined" && nav.share) {
      nav.share({ title: "Check-in StayHost", text }).catch(() => {});
      return;
    }

    // Intento 2: wa.me sin número — abre WhatsApp Web con el mensaje
    // pre-cargado; el host elige el contacto manualmente.
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");

    // Paralelo: copiar al portapapeles por si WhatsApp Web falla.
    navigator.clipboard.writeText(text).catch(() => {});
  }

  // ─── WiFi ─────────────────────────────────────────────────────────────────

  function saveWifi() {
    if (!wifiForm.propertyId || !wifiForm.ssid) return;
    const next = [...wifiConfigs.filter(w => w.propertyId !== wifiForm.propertyId), { ...wifiForm }];
    setWifiConfigs(next);
    localStorage.setItem("stayhost_wifi_configs", JSON.stringify(next));
    setWifiForm({ propertyId: "", propertyName: "", ssid: "", password: "" });
  }

  // ─── Stats ────────────────────────────────────────────────────────────────
  // NOTA: stats se calcula sobre dedupedRecords (definido abajo) para que los
  // contadores no cuenten duplicados de BD. Lo declaramos después del dedup.

  // ─── Filter logic ─────────────────────────────────────────────────────────

  // Dedup de visualizacion: si hay duplicados en BD (de corridas previas con
  // race condition), quedamos con uno solo por (propiedad + checkin + checkout).
  // Preferimos el que ya tiene accessGranted o idStatus != pending para no
  // perder el trabajo hecho en el huesped.
  const dedupedRecords = (() => {
    const byKey = new Map<string, LocalCheckIn>();
    for (const r of records) {
      const key = `${r.propertyId}|${r.checkin}|${r.checkout}|${r.guestLastName}`;
      const prev = byKey.get(key);
      if (!prev) { byKey.set(key, r); continue; }
      // Score: mayor es mejor (más "progreso" del huésped)
      const score = (x: LocalCheckIn) =>
        (x.accessGranted ? 10 : 0) +
        (x.idStatus === "validated" ? 4 : x.idStatus === "uploaded" ? 2 : 0) +
        (x.electricityPaid ? 1 : 0);
      if (score(r) > score(prev)) byKey.set(key, r);
    }
    return Array.from(byKey.values());
  })();

  const stats = {
    total: dedupedRecords.length,
    validated: dedupedRecords.filter(r => r.accessGranted).length,
    idReview: dedupedRecords.filter(r => r.idStatus === "uploaded").length,
    autoGen: dedupedRecords.filter(r => r.source !== "manual").length,
  };

  const today = new Date().toISOString().slice(0, 10);
  const filtered = dedupedRecords.filter(r => {
    if (search && !`${r.guestName} ${r.guestLastName} ${r.propertyName}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "today") return r.checkin === today || r.checkout === today;
    if (filter === "review") return r.idStatus === "uploaded";
    if (filter === "granted") return r.accessGranted;
    if (filter === "pending") return !r.accessGranted && r.idStatus !== "rejected";
    return true;
  });

  // ─── Complete Data Modal ────────────────────────────────────────────────
  const [enrichRecord, setEnrichRecord] = useState(null as LocalCheckIn | null);
  const [enrichForm, setEnrichForm] = useState({ firstName: "", lastName: "", last4: "" });

  async function handleEnrich() {
    if (!enrichRecord) return;
    if (!enrichForm.firstName || !enrichForm.lastName || enrichForm.last4.length !== 4) return;

    const wifi = wifiConfigs.find(w => w.propertyId === enrichRecord.propertyId);
    try {
      await apiCheckin("update", {
        id: enrichRecord.id,
        guestName: enrichForm.firstName,
        guestLastName: enrichForm.lastName,
        lastFourDigits: enrichForm.last4,
        wifiSsid: enrichRecord.wifiSsid || wifi?.ssid,
        wifiPassword: enrichRecord.wifiPassword || wifi?.password,
        missingData: false,
      });
      await refreshRecords();
      setEnrichRecord(null);
    } catch (err) {
      console.error("[CheckInsPanel] enrich failed:", err);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const filterPills: { key: "all" | "today" | "review" | "granted" | "pending"; label: string; count?: number }[] = [
    { key: "all", label: "Todos", count: records.length },
    { key: "today", label: "Hoy" },
    { key: "review", label: "ID Revisión", count: stats.idReview },
    { key: "granted", label: "Con Acceso", count: stats.validated },
    { key: "pending", label: "Pendientes" },
  ];

  function getAvatarColor(c: LocalCheckIn) {
    if (c.source === "auto_ical") {
      if (c.channel === "airbnb") return "bg-rose-500";
      if (c.channel === "vrbo") return "bg-blue-500";
      return "bg-indigo-500";
    }
    if (c.source === "auto_direct") return "bg-violet-500";
    return "bg-slate-400";
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Check-ins Digitales</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Portal de húespedes y validación de identidad</p>
          </div>
          <Button
            variant="outline"
            onClick={() => autoSync(false)}
            disabled={syncing}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            Sincronizar
          </Button>
        </div>

        {/* Search + Filter bar */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nombre o propiedad..."
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {filterPills.map(pill => (
              <button
                type="button"
                key={pill.key}
                onClick={() => setFilter(pill.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                  filter === pill.key
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {pill.label}
                {pill.count !== undefined && (
                  <span className={`ml-1.5 px-1 rounded-sm text-[10px] ${filter === pill.key ? "bg-white/20" : "bg-muted"}`}>
                    {pill.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── KPI Strip ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Check-ins", value: stats.total, icon: LogIn, color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-950/30" },
          { label: "Con Acceso", value: stats.validated, icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
          { label: "ID en Revisión", value: stats.idReview, icon: Eye, color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-950/30" },
          { label: "Auto-generados", value: stats.autoGen, icon: Sparkles, color: "text-violet-500", bg: "bg-violet-50 dark:bg-violet-950/30" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label} className="border shadow-sm">
            <CardContent className="pt-4 pb-4">
              <div className={`inline-flex p-2 rounded-lg ${bg} mb-2`}>
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
              <p className="text-2xl font-bold leading-none">{value}</p>
              <p className="text-xs text-muted-foreground mt-1">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <Tabs defaultValue="records">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="records" className="gap-2">
            <LogIn className="h-4 w-4" />
            Check-ins
            {stats.idReview > 0 && (
              <span className="ml-1 bg-amber-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
                {stats.idReview}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="create" className="gap-2">
            <Plus className="h-4 w-4" />
            Nuevo
          </TabsTrigger>
          <TabsTrigger value="config" className="gap-2">
            <Wifi className="h-4 w-4" />
            Configuración
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Check-ins ────────────────────────────────────────────── */}
        <TabsContent value="records" className="space-y-3 mt-5">

          {/* Empty state */}
          {filtered.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="py-16 text-center space-y-3">
                <div className="mx-auto w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
                  <LogIn className="h-7 w-7 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">
                    {search || filter !== "all" ? "Sin resultados" : "Sin check-ins aún"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
                    {search || filter !== "all"
                      ? "Intenta cambiar los filtros o el término de búsqueda."
                      : "Se generarán automáticamente cuando haya reservas con número de teléfono registrado."}
                  </p>
                </div>
                {!search && filter === "all" && (
                  <Button variant="outline" size="sm" onClick={() => autoSync(false)} disabled={syncing} className="gap-2">
                    <RefreshCw className="h-4 w-4" />
                    Sincronizar ahora
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {/* Guest Cards */}
          {filtered.map(r => {
            const accentColor = r.accessGranted
              ? "border-l-emerald-500"
              : r.idStatus === "uploaded"
              ? "border-l-amber-500"
              : r.idStatus === "rejected"
              ? "border-l-red-500"
              : "border-l-slate-200 dark:border-l-slate-700";

            const initials = `${r.guestName.charAt(0)}${r.guestLastName.charAt(0)}`.toUpperCase();
            const avColor = getAvatarColor(r);

            return (
              <Card key={r.id} className={`border-l-4 ${accentColor} shadow-sm hover:shadow-md transition-shadow`}>
                <CardContent className="pt-4 pb-4 space-y-4">

                  {/* Row 1: Avatar + Name + Badges */}
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-full ${avColor} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-base leading-tight">{r.guestName} {r.guestLastName}</span>
                        <StatusBadge r={r} />
                        <SourceBadge r={r} />
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Building2 className="w-3 h-3 shrink-0" />
                          {r.propertyName || "—"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 shrink-0" />
                          {formatDate(r.checkin)} → {formatDate(r.checkout)}
                          <span className="text-muted-foreground/60">· {r.nights}n</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Row 2: Pipeline */}
                  {!r.missingData && (
                  <div className="flex items-center justify-between gap-4 px-1">
                    <PipelineSteps r={r} />
                    {r.electricityEnabled && !r.electricityPaid && (
                      <button
                        type="button"
                        onClick={() => updateRecord(r.id, { electricityPaid: true })}
                        className="flex items-center gap-1 text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2 py-1 rounded-md hover:bg-amber-100 transition-colors shrink-0"
                        title="Confirmar pago de electricidad"
                      >
                        <Zap className="w-3 h-3" />
                        ${r.electricityTotal} pendiente
                      </button>
                    )}
                    {r.electricityEnabled && r.electricityPaid && (
                      <span className="flex items-center gap-1 text-xs text-emerald-600 shrink-0">
                        <Zap className="w-3 h-3" />${r.electricityTotal} pagado
                      </span>
                    )}
                  </div>
                  )}

                  {/* Approve/Reject inline when ID uploaded */}
                  {r.idStatus === "uploaded" && !r.missingData && (
                    <div className="flex items-center gap-2 px-1 py-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                      <Eye className="w-4 h-4 text-amber-600 shrink-0" />
                      <span className="text-xs text-amber-700 dark:text-amber-400 flex-1">ID enviado — requiere revisión</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateRecord(r.id, { idStatus: "validated" })}
                        className="h-7 px-3 text-xs border-emerald-400 text-emerald-700 hover:bg-emerald-50 gap-1"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />Aprobar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateRecord(r.id, { idStatus: "rejected" })}
                        className="h-7 px-3 text-xs border-red-400 text-red-600 hover:bg-red-50 gap-1"
                      >
                        <ShieldX className="w-3.5 h-3.5" />Rechazar
                      </Button>
                    </div>
                  )}

                  {/* Extra section for iCal missing data enrichment */}
                  {r.missingData && (
                    <div className="flex items-center justify-between gap-3 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-900 rounded-lg p-3">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-orange-800 dark:text-orange-400 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 shrink-0" /> Acción Requerida
                        </p>
                        <p className="text-xs text-orange-700 dark:text-orange-500 mt-1">
                          Esta reserva proviene de iCal y le faltan datos críticos del huésped. Complétalos para activar el Check-in Digital y generar el enlace de acceso.
                        </p>
                      </div>
                      <Button 
                        size="sm" 
                        className="shrink-0 bg-orange-600 hover:bg-orange-700 text-white"
                        onClick={() => {
                          setEnrichRecord(r);
                          setEnrichForm({ firstName: "", lastName: "", last4: "" });
                        }}
                      >
                        Completar Datos
                      </Button>
                    </div>
                  )}

                  {/* Row 3: Actions */}
                  <div className="flex items-center gap-2 pt-1 border-t">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyLink(r)}
                      disabled={r.missingData}
                      className="flex-1 h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {copiedId === r.id
                        ? <><Check className="h-3.5 w-3.5 text-emerald-500" />Copiado</>
                        : <><Copy className="h-3.5 w-3.5" />Copiar enlace</>
                      }
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => shareWhatsApp(r)}
                      disabled={r.missingData}
                      className="flex-1 h-8 gap-1.5 text-xs text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />WhatsApp
                    </Button>
                    <Button variant="ghost" size="sm" asChild disabled={r.missingData} className="flex-1 h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                      <a href={r.link || buildLink(r.id, r.encodedData)} target={r.missingData ? "_self" : "_blank"} rel="noopener noreferrer" onClick={e => r.missingData && e.preventDefault()}>
                        <ExternalLink className="h-3.5 w-3.5" />Abrir
                      </a>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setViewQrRecord(r)}
                      disabled={r.missingData}
                      className="flex-1 h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <QrCode className="h-3.5 w-3.5" />QR
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteRecord(r.id)}
                      className="h-8 px-2 text-muted-foreground hover:text-destructive"
                      title="Eliminar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* ── Tab 2: Nuevo Check-in ────────────────────────────────────────── */}
        <TabsContent value="create" className="mt-5">
          <div className="grid md:grid-cols-2 gap-5">

            {/* Section: Huésped */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" />
                  Huésped
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Nombre *</Label>
                    <Input
                      value={form.guestName}
                      onChange={e => setForm(f => ({...f, guestName: e.target.value}))}
                      placeholder="Carlos"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Apellido *</Label>
                    <Input
                      value={form.guestLastName}
                      onChange={e => setForm(f => ({...f, guestLastName: e.target.value}))}
                      placeholder="Rodríguez"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>PIN de acceso (4 dígitos) *</Label>
                  <Input
                    value={form.lastFourDigits}
                    onChange={e => setForm(f => ({...f, lastFourDigits: e.target.value.replace(/\D/g,"").slice(0,4)}))}
                    placeholder="5678"
                    maxLength={4}
                    className="font-mono tracking-[0.5em] text-center text-2xl h-14"
                  />
                  <p className="text-xs text-muted-foreground">Últimos 4 dígitos del teléfono. Clave de cerradura TTLock.</p>
                </div>
              </CardContent>
            </Card>

            {/* Section: Estancia */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-primary" />
                  Estancia
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Check-in *</Label>
                    <Input type="date" value={form.checkin} onChange={e => setForm(f => ({...f, checkin: e.target.value}))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Check-out *</Label>
                    <Input type="date" value={form.checkout} onChange={e => setForm(f => ({...f, checkout: e.target.value}))} />
                  </div>
                </div>
                {form.checkin && form.checkout && diffNights(form.checkin, form.checkout) > 0 && (
                  <p className="text-xs text-muted-foreground bg-muted px-3 py-2 rounded-md">
                    {diffNights(form.checkin, form.checkout)} noches
                  </p>
                )}
                <div className="space-y-1.5">
                  <Label>Propiedad</Label>
                  {properties.length > 0 ? (
                    <select
                      value={form.propertyId}
                      onChange={e => {
                        const p = properties.find(x => x.id === e.target.value);
                        const ec = elecConfigs.find(c => c.propertyId === e.target.value);
                        setForm(f => ({
                          ...f,
                          propertyId: e.target.value,
                          propertyName: p?.name ?? "",
                          propertyAddress: p?.address ?? "",
                          electricityEnabled: ec ? ec.enabled : true,
                          electricityRate: ec ? ec.rate : 5,
                          paypalFeeIncluded: ec ? ec.paypal : true,
                        }));
                      }}
                      className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                      aria-label="Seleccionar propiedad">
                      <option value="">Seleccionar...</option>
                      {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  ) : (
                    <Input value={form.propertyName} onChange={e => setForm(f => ({...f, propertyName: e.target.value}))} placeholder="Villa Mar" />
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Section: Acceso (preview) */}
            <Card className="md:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-500" />
                  Acceso y Tarifas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-4">
                  {/* WiFi preview */}
                  <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
                    <Wifi className="h-5 w-5 text-blue-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium">WiFi configurado</p>
                      {form.propertyId && wifiConfigs.find(w => w.propertyId === form.propertyId) ? (
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          {wifiConfigs.find(w => w.propertyId === form.propertyId)?.ssid}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">Selecciona propiedad</p>
                      )}
                    </div>
                  </div>

                  {/* Electricity toggle + preview */}
                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <Zap className="h-5 w-5 text-amber-500 shrink-0" />
                      <div>
                        <p className="text-sm font-medium">Tarifa Eléctrica</p>
                        {form.electricityEnabled && form.checkin && form.checkout && diffNights(form.checkin, form.checkout) > 0 && (
                          <p className="text-xs text-amber-600">
                            = ${calcElectricity(diffNights(form.checkin, form.checkout), form.electricityRate, form.paypalFeeIncluded).toFixed(2)} USD
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setForm(f => ({...f, electricityEnabled: !f.electricityEnabled}))}
                      className={`w-10 h-6 rounded-full transition-colors shrink-0 ${form.electricityEnabled ? "bg-amber-500" : "bg-muted"}`}
                      aria-label={form.electricityEnabled ? "Desactivar tarifa eléctrica" : "Activar tarifa eléctrica"}>
                      <div className={`w-4 h-4 rounded-full bg-white mx-auto transition-transform ${form.electricityEnabled ? "translate-x-2" : "-translate-x-2"}`} />
                    </button>
                  </div>
                </div>

                {createError && (
                  <div className="mt-4 flex items-center gap-2 text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    {createError}
                  </div>
                )}

                <Button onClick={handleCreate} className="w-full mt-4 h-11 text-base gap-2">
                  <Plus className="h-5 w-5" />
                  Crear y Generar Enlace
                </Button>
              </CardContent>
            </Card>

          </div>
        </TabsContent>

        {/* ── Tab 3: Configuración ─────────────────────────────────────────── */}
        <TabsContent value="config" className="mt-5">
          <div className="grid md:grid-cols-2 gap-5">

            {/* WiFi Card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Wifi className="h-4 w-4 text-blue-500" />
                  WiFi por Propiedad
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {wifiConfigs.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">No hay redes WiFi configuradas.</p>
                )}
                {wifiConfigs.map(w => (
                  <div key={w.propertyId} className="flex items-center justify-between p-3 border rounded-lg bg-muted/20">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{w.propertyName || w.propertyId}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {w.ssid} · {showWifiPass[w.propertyId] ? w.password : "••••••••"}
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2">
                      <Button
                        variant="ghost" size="sm" className="h-7 px-2"
                        onClick={() => setShowWifiPass(s => ({...s, [w.propertyId]: !s[w.propertyId]}))}
                        aria-label={showWifiPass[w.propertyId] ? "Ocultar contraseña" : "Ver contraseña"}>
                        {showWifiPass[w.propertyId] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          const n = wifiConfigs.filter(x => x.propertyId !== w.propertyId);
                          setWifiConfigs(n);
                          localStorage.setItem("stayhost_wifi_configs", JSON.stringify(n));
                        }}
                        aria-label="Eliminar WiFi">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}

                <div className="space-y-3 border-t pt-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Agregar / Actualizar</p>
                  {properties.length > 0 ? (
                    <select
                      value={wifiForm.propertyId}
                      onChange={e => {
                        const p = properties.find(x => x.id === e.target.value);
                        setWifiForm(f => ({...f, propertyId: e.target.value, propertyName: p?.name ?? ""}));
                      }}
                      className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                      aria-label="Propiedad para WiFi">
                      <option value="">Seleccionar propiedad...</option>
                      {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  ) : (
                    <Input
                      value={wifiForm.propertyName}
                      onChange={e => setWifiForm(f => ({...f, propertyId: e.target.value.toLowerCase().replace(/\s+/g,"-"), propertyName: e.target.value}))}
                      placeholder="Nombre de propiedad"
                    />
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Red (SSID)</Label>
                      <Input value={wifiForm.ssid} onChange={e => setWifiForm(f => ({...f, ssid: e.target.value}))} placeholder="VillaMar_5G" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Contraseña</Label>
                      <Input type="password" value={wifiForm.password} onChange={e => setWifiForm(f => ({...f, password: e.target.value}))} placeholder="••••••••" />
                    </div>
                  </div>
                  <Button onClick={saveWifi} disabled={!wifiForm.propertyId || !wifiForm.ssid} variant="outline" className="w-full gap-2">
                    <Wifi className="h-4 w-4" />Guardar WiFi
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Electricity Card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-500" />
                  Tarifa Eléctrica por Propiedad
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">Configura si cada propiedad cobra electricidad, a qué tarifa y si incluir la comisión PayPal.</p>

                {elecConfigs.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">Sin configuraciones eléctricas aún.</p>
                )}

                {elecConfigs.map(ec => {
                  const propName = properties.find(p => p.id === ec.propertyId)?.name ?? ec.propertyId;
                  return (
                    <div key={ec.propertyId} className="flex items-center justify-between p-3 border rounded-lg bg-muted/20 gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{propName}</p>
                        {ec.enabled ? (
                          <p className="text-xs text-amber-600">${ec.rate}/noche{ec.paypal ? " + PayPal" : ""}</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Sin cargo eléctrico</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge
                          variant={ec.enabled ? "default" : "secondary"}
                          className={ec.enabled ? "bg-amber-500/20 text-amber-700 border-amber-500/30" : ""}>
                          {ec.enabled ? "Activo" : "Sin cargo"}
                        </Badge>
                        <Button
                          variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-destructive"
                          aria-label="Eliminar config eléctrica"
                          onClick={() => {
                            const next = elecConfigs.filter(c => c.propertyId !== ec.propertyId);
                            setElecConfigs(next);
                            localStorage.setItem("stayhost_elec_config", JSON.stringify(next));
                          }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}

                <ElecConfigForm
                  properties={properties}
                  existing={elecConfigs}
                  onSave={(cfg) => {
                    const next = [...elecConfigs.filter(c => c.propertyId !== cfg.propertyId), cfg];
                    setElecConfigs(next);
                    localStorage.setItem("stayhost_elec_config", JSON.stringify(next));
                  }}
                />

                <div className="font-mono text-xs bg-muted rounded p-3 space-y-1 border-t pt-4">
                  <p className="text-muted-foreground font-sans font-medium not-italic text-[11px]">Fórmula con comisión PayPal (5.7%):</p>
                  <p>total = (noches × tarifa) / 0.943</p>
                  <p className="text-muted-foreground">// Ej: 3 noches × $5 = $15.91 USD → tú recibes $15 netos</p>
                </div>
              </CardContent>
            </Card>

          </div>
        </TabsContent>
      </Tabs>

      {/* ── QR Modal ──────────────────────────────────────────────────────── */}
      <Dialog open={!!viewQrRecord} onOpenChange={() => setViewQrRecord(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>Pase de Acceso — Titan Coloso</DialogTitle></DialogHeader>
          {viewQrRecord && (
            <div className="space-y-4 text-center">
              <div>
                <p className="font-semibold">{viewQrRecord.guestName} {viewQrRecord.guestLastName}</p>
                <p className="text-sm text-muted-foreground">{viewQrRecord.propertyName}</p>
                <p className="text-xs text-muted-foreground">{formatDate(viewQrRecord.checkin)} → {formatDate(viewQrRecord.checkout)}</p>
              </div>
              <div className="flex justify-center">
                <div className="bg-white rounded-xl p-3">
                  <img
                    src={qrUrl(JSON.stringify({
                      id: viewQrRecord.id,
                      guest: `${viewQrRecord.guestName} ${viewQrRecord.guestLastName}`,
                      property: viewQrRecord.propertyName,
                      checkin: viewQrRecord.checkin,
                      checkout: viewQrRecord.checkout,
                    }), 200)}
                    alt="QR de acceso"
                    width={200}
                    height={200}
                    className="rounded-lg"
                  />
                </div>
              </div>
              <code className="text-xs text-muted-foreground">{viewQrRecord.id.slice(-8).toUpperCase()}</code>
              <StatusBadge r={viewQrRecord} />
              <p className="text-xs text-muted-foreground">El vigilante escanea este QR en la entrada para verificar el acceso.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* ── Enrich Data Modal ──────────────────────────────────────────────── */}
      <Dialog open={!!enrichRecord} onOpenChange={(open) => !open && setEnrichRecord(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Completar Datos de Reserva</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Esta reserva ingresó por iCal ({enrichRecord?.channel}). Completa la información básica del huésped para que pueda realizar su Check-in Digital.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nombre</Label>
                <Input 
                  placeholder="Juan" 
                  value={enrichForm.firstName} 
                  onChange={e => setEnrichForm(f => ({ ...f, firstName: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Apellido</Label>
                <Input 
                  placeholder="Pérez" 
                  value={enrichForm.lastName} 
                  onChange={e => setEnrichForm(f => ({ ...f, lastName: e.target.value }))}
                />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>Últimos 4 dígitos del número de teléfono real del huésped (PIN Cerradura)</Label>
                <Input 
                  placeholder="1234" 
                  maxLength={4}
                  value={enrichForm.last4} 
                  onChange={e => setEnrichForm(f => ({ ...f, last4: e.target.value.replace(/\D/g,"") }))}
                />
              </div>
            </div>
            <div className="pt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEnrichRecord(null)}>Cancelar</Button>
              <Button 
                onClick={handleEnrich} 
                disabled={!enrichForm.firstName || !enrichForm.lastName || enrichForm.last4.length !== 4}
              >
                Guardar y Activar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
