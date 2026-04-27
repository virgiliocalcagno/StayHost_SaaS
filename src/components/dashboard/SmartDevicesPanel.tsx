"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Smartphone, Lock, Thermometer, Wifi, WifiOff, Key, Plus, RefreshCw,
  Settings, Battery, CheckCircle2, Zap,
  Clock, Copy, Link2,
  Droplets, Loader2, Calendar, Phone, Home,
  X, BookOpen,
  Activity, AlertTriangle, Edit3,
  BrainCircuit,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useModules } from "@/context/ModuleContext";
import TTLockAccountsSection from "./smart-devices/TTLockAccountsSection";
import ImportWizardDialog from "./smart-devices/ImportWizardDialog";
import type {
  TabType,
  SmartDevice,
  AccessPin,
  ICalConfig,
  Integrations,
  DeviceType,
  DeviceProvider,
} from "./smart-devices/types";
import {
  DEVICE_ICONS,
  DEVICE_LABELS,
  CHANNEL_LABELS,
  CHANNEL_COLORS,
  batteryColor,
  isExpiredPin,
  formatDateTime,
  localInputToIso,
  isoToLocalInput,
} from "./smart-devices/utils";

// ─── Local DB-shaped types ──────────────────────────────────────────────────

type PropertyRow = {
  id: string;
  name: string;
  ttlock_lock_id: string | number | null;
  ttlock_account_id: string | null;
  ical_airbnb: string | null;
  ical_vrbo: string | null;
};

type TTLockAccountRow = {
  id: string;
  label: string;
  ttlock_username: string;
  expired?: boolean;
  last_synced_at?: string | null;
};

type LockLive = {
  lockId: string;
  name: string;
  battery: number | null;
  accountId: string;
};

type PinRow = {
  id: string;
  property_id: string;
  booking_id: string | null;
  ttlock_lock_id: string | null;
  ttlock_pwd_id: string | null;
  guest_name: string;
  guest_phone: string | null;
  pin: string;
  source: AccessPin["source"];
  status: AccessPin["status"];
  valid_from: string;
  valid_to: string;
  created_at: string;
  properties?: { name: string } | { name: string }[] | null;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    credentials: "same-origin",
    headers: {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
    body: json ? JSON.stringify(json) : rest.body,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) {
    // Preferimos el `message` humano sobre el `error` tipo código, cuando
    // ambos están — así el usuario ve "La propiedad apunta a una cuenta
    // que ya no existe" en vez de "ACCOUNT_NOT_FOUND".
    const d = data as { error?: string; message?: string };
    throw new Error(d.message ?? d.error ?? `HTTP ${res.status}`);
  }
  return data;
}

function propertyName(p: PinRow): string {
  const rel = p.properties;
  if (!rel) return "";
  if (Array.isArray(rel)) return rel[0]?.name ?? "";
  return rel.name ?? "";
}

function pinRowToAccessPin(p: PinRow): AccessPin {
  return {
    id: p.id,
    deviceId: p.ttlock_lock_id ? `lock-${p.property_id}` : "",
    deviceName: p.ttlock_lock_id ? "Cerradura" : "",
    propertyId: p.property_id,
    propertyName: propertyName(p),
    guestName: p.guest_name,
    guestPhone: p.guest_phone ?? undefined,
    pin: p.pin,
    source: p.source,
    bookingRef: p.booking_id ?? undefined,
    validFrom: p.valid_from,
    validTo: p.valid_to,
    status: p.status,
    ttlockPwdId: p.ttlock_pwd_id ?? undefined,
    createdAt: p.created_at,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

export default function SmartDevicesPanel() {
  const { userRole } = useModules();
  const [activeTab, setActiveTab] = useState<TabType>("devices");
  const isAdminMode = userRole === "OWNER";

  // Import Wizard
  const [showImportWizard, setShowImportWizard] = useState(false);

  // ── DB-backed state ────────────────────────────────────────────────────────
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [accounts, setAccounts] = useState<TTLockAccountRow[]>([]);
  const [pins, setPins] = useState<AccessPin[]>([]);
  const [liveLocks, setLiveLocks] = useState<Record<string, LockLive>>({}); // key = lockId

  // Legacy credentials state (only for Import Wizard, kept in localStorage)
  const [integrations, setIntegrations] = useState<Integrations>(() => {
    const empty: Integrations = {
      tuya: { clientId: "", clientSecret: "", region: "eu", uid: "" },
      ttlock: { clientId: "", clientSecret: "", username: "", password: "" },
    };
    if (typeof window === "undefined") return empty;
    try {
      const r = localStorage.getItem("stayhost_integrations");
      return r ? JSON.parse(r) : empty;
    } catch {
      return empty;
    }
  });
  useEffect(() => {
    localStorage.setItem("stayhost_integrations", JSON.stringify(integrations));
  }, [integrations]);

  // ── Transient UI state ─────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncingIcalId, setSyncingIcalId] = useState<string | null>(null);
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [unlockMsg, setUnlockMsg] = useState<{ deviceId: string; text: string; ok: boolean } | null>(null);

  // Estado de gateways TTLock por propertyId. Lo refrescamos al entrar a
  // la pestaña Dispositivos. Si TTLock tarda en responder o falla,
  // dejamos `null` (= "no sabemos") y la UI muestra estado neutro en vez
  // de un falso "offline".
  type GatewayInfo = {
    isOnline: boolean;
    networkName: string | null;
    gatewayName: string | null;
    signal: number | null;
    reason: "no_account" | "no_gateway" | "not_linked" | null;
  };
  const [gatewayByProp, setGatewayByProp] = useState<Record<string, GatewayInfo | null>>({});
  const [gatewaysLoading, setGatewaysLoading] = useState(false);

  const refreshGateways = useCallback(async () => {
    setGatewaysLoading(true);
    try {
      const res = await fetch("/api/gateways/status", { credentials: "same-origin" });
      if (!res.ok) return;
      const json = (await res.json()) as {
        gateways?: Array<{
          propertyId: string;
          isOnline: boolean;
          networkName: string | null;
          gatewayName: string | null;
          signal: number | null;
          reason: "no_account" | "no_gateway" | "not_linked" | null;
        }>;
      };
      const map: Record<string, GatewayInfo | null> = {};
      for (const g of json.gateways ?? []) {
        map[g.propertyId] = {
          isOnline: g.isOnline,
          networkName: g.networkName,
          gatewayName: g.gatewayName,
          signal: g.signal,
          reason: g.reason,
        };
      }
      setGatewayByProp(map);
    } catch (err) {
      console.warn("[gateways/status] fetch failed:", err);
    } finally {
      setGatewaysLoading(false);
    }
  }, []);

  // Pin form
  const [showPinForm, setShowPinForm] = useState(false);
  const [pinForm, setPinForm] = useState({
    propertyId: "", guestName: "", guestPhone: "", pin: "",
    validFrom: "", validTo: "",
  });
  const [pinSaving, setPinSaving] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [editingPinId, setEditingPinId] = useState<string | null>(null);

  // iCal form
  const [showIcalForm, setShowIcalForm] = useState(false);
  const [icalForm, setIcalForm] = useState({
    propertyId: "",
    channel: "airbnb" as "airbnb" | "vrbo",
    url: "",
  });
  const [icalSaving, setIcalSaving] = useState(false);
  const [icalError, setIcalError] = useState<string | null>(null);

  // ── Loaders ────────────────────────────────────────────────────────────────
  const refreshProperties = useCallback(async () => {
    try {
      const data = await api<{ properties?: PropertyRow[] }>("/api/properties");
      const normalized = (data.properties ?? []).map((p) => ({
        ...p,
        ttlock_lock_id: p.ttlock_lock_id == null ? null : String(p.ttlock_lock_id),
      }));
      setProperties(normalized);
    } catch (err) {
      console.error("[smart-devices] refreshProperties:", err);
    }
  }, []);

  const refreshAccounts = useCallback(async () => {
    try {
      const data = await api<{ accounts?: TTLockAccountRow[] }>("/api/ttlock/accounts");
      setAccounts(data.accounts ?? []);
    } catch (err) {
      console.error("[smart-devices] refreshAccounts:", err);
    }
  }, []);

  const refreshPins = useCallback(async () => {
    try {
      const data = await api<{ pins?: PinRow[] }>("/api/access-pins");
      setPins((data.pins ?? []).map(pinRowToAccessPin));
    } catch (err) {
      console.error("[smart-devices] refreshPins:", err);
    }
  }, []);

  const refreshLocks = useCallback(async (accountList: TTLockAccountRow[]) => {
    const next: Record<string, LockLive> = {};
    for (const acc of accountList) {
      if (acc.expired) continue;
      try {
        const data = await api<{ locks?: Array<{ lockId: string; name: string; battery: number | null }> }>(
          "/api/ttlock/accounts",
          { method: "POST", json: { action: "listLocks", accountId: acc.id } }
        );
        for (const l of data.locks ?? []) {
          next[String(l.lockId)] = { ...l, lockId: String(l.lockId), accountId: acc.id };
        }
      } catch (err) {
        console.warn("[smart-devices] listLocks failed for account", acc.id, err);
      }
    }
    setLiveLocks(next);
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([refreshProperties(), refreshPins()]);
      const data = await api<{ accounts?: TTLockAccountRow[] }>("/api/ttlock/accounts");
      const accs = data.accounts ?? [];
      setAccounts(accs);
      await refreshLocks(accs);
    } finally {
      setLoading(false);
    }
  }, [refreshProperties, refreshPins, refreshLocks]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  // ── Derived views ──────────────────────────────────────────────────────────
  const devices: SmartDevice[] = useMemo(() => {
    return properties
      .filter((p) => p.ttlock_lock_id)
      .map((p) => {
        const lockId = String(p.ttlock_lock_id);
        const live = liveLocks[lockId];
        return {
          id: `lock-${p.id}`,
          remoteId: lockId,
          name: live?.name ?? `Cerradura · ${p.name}`,
          type: "lock_ttlock" as DeviceType,
          provider: "ttlock" as DeviceProvider,
          propertyId: p.id,
          propertyName: p.name,
          online: !!live,
          battery: live?.battery ?? undefined,
          locked: true,
          lastSync: live ? new Date().toISOString() : undefined,
        };
      });
  }, [properties, liveLocks]);

  const icalConfigs: ICalConfig[] = useMemo(() => {
    const list: ICalConfig[] = [];
    for (const p of properties) {
      if (p.ical_airbnb) {
        list.push({
          id: `ical-${p.id}-airbnb`,
          propertyId: p.id,
          propertyName: p.name,
          channel: "airbnb",
          url: p.ical_airbnb,
          autoGeneratePins: true,
          targetDeviceId: p.ttlock_lock_id ? `lock-${p.id}` : undefined,
        });
      }
      if (p.ical_vrbo) {
        list.push({
          id: `ical-${p.id}-vrbo`,
          propertyId: p.id,
          propertyName: p.name,
          channel: "vrbo",
          url: p.ical_vrbo,
          autoGeneratePins: true,
          targetDeviceId: p.ttlock_lock_id ? `lock-${p.id}` : undefined,
        });
      }
    }
    return list;
  }, [properties]);

  const lockDevices = devices;
  const online = devices.filter((d) => d.online).length;
  const offline = devices.filter((d) => !d.online).length;
  const lowBattery = devices.filter((d) => (d.battery ?? 100) <= 20).length;
  const activePins = pins.filter((p) => p.status === "active" && !isExpiredPin(p.validTo)).length;

  // ── Remote unlock (server-side via account) ────────────────────────────────
  const handleRemoteUnlock = useCallback(
    async (device: SmartDevice) => {
      const prop = properties.find((p) => p.id === device.propertyId);
      if (!prop?.ttlock_account_id || !prop.ttlock_lock_id) {
        setUnlockMsg({ deviceId: device.id, text: "Asigna cuenta y cerradura primero", ok: false });
        return;
      }
      setUnlockingId(device.id);
      setUnlockMsg(null);
      try {
        const data = await api<{ errcode?: number; errmsg?: string }>("/api/ttlock/accounts", {
          method: "POST",
          json: {
            action: "unlock",
            accountId: prop.ttlock_account_id,
            lockId: String(prop.ttlock_lock_id),
          },
        });
        if (data.errcode === 0) {
          setUnlockMsg({ deviceId: device.id, text: "Abierta", ok: true });
        } else {
          setUnlockMsg({
            deviceId: device.id,
            text: data.errmsg ?? `Error ${data.errcode ?? ""}`.trim(),
            ok: false,
          });
        }
      } catch (e) {
        setUnlockMsg({ deviceId: device.id, text: String(e), ok: false });
      } finally {
        setUnlockingId(null);
        setTimeout(() => setUnlockMsg((m) => (m?.deviceId === device.id ? null : m)), 4000);
      }
    },
    [properties]
  );

  // ── Sync all (refresh locks live state) ────────────────────────────────────
  // Also refresca `properties` para traer cualquier asignación lock↔property
  // que haya pasado en la pestaña Configuración (TTLockAccountsSection tiene
  // su propio estado y no lo comparte con el padre).
  const handleSyncAll = useCallback(async () => {
    setSyncing(true);
    try {
      await Promise.all([refreshProperties(), refreshPins()]);
      await refreshLocks(accounts);
    } finally {
      setSyncing(false);
    }
  }, [refreshProperties, refreshLocks, refreshPins, accounts]);

  // Cuando el usuario vuelve a la pestaña "Dispositivos", re-leer properties
  // y estado de gateways. Sin re-fetch del gateway, el badge "online/offline"
  // queda con la foto del primer load — un gateway que se cae mientras el
  // host esta en otra pestaña no se reflejaria.
  useEffect(() => {
    if (activeTab === "devices") {
      void refreshProperties();
      void refreshGateways();
    }
  }, [activeTab, refreshProperties, refreshGateways]);

  // ── PIN create / update ────────────────────────────────────────────────────
  const resetPinForm = () => {
    setPinForm({ propertyId: "", guestName: "", guestPhone: "", pin: "", validFrom: "", validTo: "" });
    setEditingPinId(null);
    setPinError(null);
  };

  const programPinOnLock = useCallback(
    async (
      prop: PropertyRow,
      pinVal: string,
      validFrom: string,
      validTo: string,
      name: string
    ): Promise<{ id?: string; error?: string }> => {
      if (!prop.ttlock_account_id) {
        return { error: "Esta propiedad no tiene una cuenta TTLock asignada" };
      }
      if (!prop.ttlock_lock_id) {
        return { error: "Esta propiedad no tiene una cerradura TTLock asignada" };
      }
      try {
        const data = await api<{ keyboardPwdId?: number | string; errcode?: number; errmsg?: string }>(
          "/api/ttlock/accounts",
          {
            method: "POST",
            json: {
              action: "createPin",
              accountId: prop.ttlock_account_id,
              lockId: String(prop.ttlock_lock_id),
              pin: pinVal,
              name,
              startDate: new Date(validFrom).getTime(),
              endDate: new Date(validTo).getTime(),
            },
          }
        );
        if (data.keyboardPwdId != null) return { id: String(data.keyboardPwdId) };
        const msg =
          data.errmsg ??
          (data.errcode != null ? `TTLock errcode ${data.errcode}` : "TTLock no devolvió un ID de PIN");
        console.warn("[smart-devices] TTLock createPin response:", data);
        return { error: msg };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[smart-devices] TTLock createPin failed:", msg);
        return { error: msg };
      }
    },
    []
  );

  const revokePinOnLock = useCallback(
    async (prop: PropertyRow | undefined, ttlockPwdId: string | undefined) => {
      if (!prop?.ttlock_account_id || !prop.ttlock_lock_id || !ttlockPwdId) return;
      try {
        await api("/api/ttlock/accounts", {
          method: "POST",
          json: {
            action: "deletePin",
            accountId: prop.ttlock_account_id,
            lockId: String(prop.ttlock_lock_id),
            keyboardPwdId: ttlockPwdId,
          },
        });
      } catch (err) {
        console.warn("[smart-devices] TTLock deletePin failed:", err);
      }
    },
    []
  );

  const handleCreatePin = async () => {
    setPinError(null);
    if (!pinForm.propertyId || !pinForm.guestName || !pinForm.pin || !pinForm.validFrom || !pinForm.validTo) {
      setPinError("Completa todos los campos obligatorios");
      return;
    }
    if (!/^\d{4,8}$/.test(pinForm.pin)) {
      setPinError("PIN debe tener 4-8 dígitos");
      return;
    }
    if (new Date(pinForm.validTo) <= new Date(pinForm.validFrom)) {
      setPinError("Válido hasta debe ser posterior a válido desde");
      return;
    }

    const prop = properties.find((p) => p.id === pinForm.propertyId);
    if (!prop) {
      setPinError("Propiedad no encontrada");
      return;
    }

    setPinSaving(true);
    let lockWarning: string | null = null;
    // Convertimos la hora local del navegador a ISO UTC antes de mandar al
    // backend. Sin esto, Postgres interpreta el string sin TZ como UTC y el
    // PIN queda desfasado 4 horas (en AST, sale "expirado" en el acto).
    const validFromIso = localInputToIso(pinForm.validFrom);
    const validToIso = localInputToIso(pinForm.validTo);
    try {
      if (editingPinId) {
        // Update existing: revoke old TTLock pin and create new one if needed
        const old = pins.find((p) => p.id === editingPinId);
        if (old?.ttlockPwdId) {
          await revokePinOnLock(prop, old.ttlockPwdId);
        }
        const result = await programPinOnLock(
          prop, pinForm.pin, pinForm.validFrom, pinForm.validTo, pinForm.guestName
        );
        if (result.error && (prop.ttlock_account_id && prop.ttlock_lock_id)) {
          lockWarning = result.error;
        }
        await api("/api/access-pins", {
          method: "PATCH",
          json: {
            id: editingPinId,
            pin: pinForm.pin,
            guest_name: pinForm.guestName,
            guest_phone: pinForm.guestPhone || null,
            valid_from: validFromIso,
            valid_to: validToIso,
            ttlock_pwd_id: result.id ?? null,
            status: "active",
          },
        });
      } else {
        // Create new
        const result = await programPinOnLock(
          prop, pinForm.pin, pinForm.validFrom, pinForm.validTo, pinForm.guestName
        );
        if (result.error && (prop.ttlock_account_id && prop.ttlock_lock_id)) {
          lockWarning = result.error;
        }
        await api("/api/access-pins", {
          method: "POST",
          json: {
            propertyId: prop.id,
            guestName: pinForm.guestName,
            guestPhone: pinForm.guestPhone || undefined,
            pin: pinForm.pin,
            validFrom: validFromIso,
            validTo: validToIso,
            source: "manual",
            ttlockLockId: prop.ttlock_lock_id ? String(prop.ttlock_lock_id) : undefined,
            ttlockPwdId: result.id,
          },
        });
      }
      await refreshPins();
      if (lockWarning) {
        // PIN quedó en DB pero no se programó en la cerradura — lo dejamos
        // abierto con el warning para que el usuario lo vea.
        setPinError(`Guardado, pero la cerradura rechazó el PIN: ${lockWarning}`);
      } else {
        setShowPinForm(false);
        resetPinForm();
      }
    } catch (err) {
      setPinError(String(err instanceof Error ? err.message : err));
    } finally {
      setPinSaving(false);
    }
  };

  // Re-enviar un PIN existente a la cerradura — para los PINs huérfanos
  // (ttlockPwdId == null) que quedaron guardados en DB pero nunca se
  // programaron (por ejemplo la primera vez que fallaron silenciosamente).
  const [reprogrammingId, setReprogrammingId] = useState<string | null>(null);
  const [reprogramMsg, setReprogramMsg] = useState<{ pinId: string; text: string; ok: boolean } | null>(null);
  const handleReprogramPin = useCallback(
    async (pin: AccessPin) => {
      const prop = properties.find((p) => p.id === pin.propertyId);
      if (!prop) return;
      setReprogrammingId(pin.id);
      setReprogramMsg(null);
      const result = await programPinOnLock(prop, pin.pin, pin.validFrom, pin.validTo, pin.guestName);
      if (result.id) {
        try {
          await api("/api/access-pins", {
            method: "PATCH",
            json: { id: pin.id, ttlock_pwd_id: result.id },
          });
          await refreshPins();
          setReprogramMsg({ pinId: pin.id, text: "Programado en cerradura", ok: true });
        } catch (err) {
          setReprogramMsg({
            pinId: pin.id,
            text: `Programado en cerradura pero no pude actualizar DB: ${err instanceof Error ? err.message : err}`,
            ok: false,
          });
        }
      } else {
        setReprogramMsg({ pinId: pin.id, text: result.error ?? "Error desconocido", ok: false });
      }
      setReprogrammingId(null);
      setTimeout(() => setReprogramMsg((m) => (m?.pinId === pin.id ? null : m)), 6000);
    },
    [properties, programPinOnLock, refreshPins]
  );

  const handleRevokePin = async (pin: AccessPin) => {
    const prop = properties.find((p) => p.id === pin.propertyId);
    if (pin.ttlockPwdId) {
      await revokePinOnLock(prop, pin.ttlockPwdId);
    }
    try {
      await api("/api/access-pins", {
        method: "PATCH",
        json: { id: pin.id, status: "revoked" },
      });
      await refreshPins();
    } catch (err) {
      console.error("[smart-devices] revoke pin:", err);
    }
  };

  const handleDeletePin = async (pin: AccessPin) => {
    if (!confirm("¿Eliminar este PIN permanentemente?")) return;
    const prop = properties.find((p) => p.id === pin.propertyId);
    if (pin.ttlockPwdId) {
      await revokePinOnLock(prop, pin.ttlockPwdId);
    }
    try {
      await api(`/api/access-pins?id=${encodeURIComponent(pin.id)}`, { method: "DELETE" });
      await refreshPins();
    } catch (err) {
      console.error("[smart-devices] delete pin:", err);
    }
  };

  // ── iCal handlers ──────────────────────────────────────────────────────────
  const handleSaveIcal = async () => {
    setIcalError(null);
    if (!icalForm.propertyId || !icalForm.url) {
      setIcalError("Propiedad y URL son obligatorios");
      return;
    }
    setIcalSaving(true);
    try {
      const field = icalForm.channel === "airbnb" ? "ical_airbnb" : "ical_vrbo";
      await api("/api/properties", {
        method: "PATCH",
        json: { propertyId: icalForm.propertyId, [field]: icalForm.url },
      });
      await refreshProperties();
      setShowIcalForm(false);
      setIcalForm({ propertyId: "", channel: "airbnb", url: "" });
    } catch (err) {
      setIcalError(String(err instanceof Error ? err.message : err));
    } finally {
      setIcalSaving(false);
    }
  };

  const handleRemoveIcal = async (config: ICalConfig) => {
    if (!confirm(`¿Quitar feed ${CHANNEL_LABELS[config.channel] ?? config.channel} de ${config.propertyName}?`)) return;
    const field = config.channel === "airbnb" ? "ical_airbnb" : "ical_vrbo";
    try {
      await api("/api/properties", {
        method: "PATCH",
        json: { propertyId: config.propertyId, [field]: null },
      });
      await refreshProperties();
    } catch (err) {
      console.error("[smart-devices] remove ical:", err);
    }
  };

  const handleSyncIcal = async (config: ICalConfig) => {
    setSyncingIcalId(config.id);
    try {
      await api("/api/ical/import", {
        method: "POST",
        json: { propertyId: config.propertyId },
      });
      // Refresh pins in case auto-generated PINs were inserted server-side
      await refreshPins();
    } catch (err) {
      console.error("[smart-devices] sync ical:", err);
    } finally {
      setSyncingIcalId(null);
    }
  };

  // ── Tabs ───────────────────────────────────────────────────────────────────
  const tabs: { id: TabType; label: string; icon: React.ElementType }[] = [
    { id: "devices", label: "Dispositivos", icon: Smartphone },
    { id: "pins", label: "Llaves & PINs", icon: Key },
    { id: "ical", label: "iCal & Acceso", icon: Calendar },
    ...(isAdminMode ? [{ id: "config" as TabType, label: "Configuración", icon: Settings }] : []),
  ];

  const propertiesWithLockIssue = properties.filter((p) => p.ttlock_lock_id && !p.ttlock_account_id);
  const accountsNeedingReconnect = accounts.filter((a) => a.expired).length;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 pb-20">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Dispositivos Inteligentes</h2>
          <p className="text-muted-foreground">Tuya · TTLock · iCal automático · PINs por reserva</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" className="gap-2" onClick={handleSyncAll} disabled={syncing || loading}>
            <RefreshCw className={cn("h-4 w-4", (syncing || loading) && "animate-spin")} />
            {syncing ? "Sincronizando..." : "Sincronizar Todo"}
          </Button>
          <Button
            className="gradient-gold text-primary-foreground gap-2"
            onClick={() => setShowImportWizard(true)}
          >
            <Zap className="h-4 w-4" /> Importar desde App
          </Button>
          {isAdminMode && (
            <Button variant="ghost" size="icon" className="rounded-xl h-10 w-10 bg-amber-100 text-amber-700" title="Modo Admin activo">
              <Settings className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Banners de estado */}
      {accountsNeedingReconnect > 0 && (
        <Card className="rounded-2xl border-amber-200 bg-amber-50">
          <CardContent className="p-4 flex items-center gap-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <p className="text-amber-800">
              {accountsNeedingReconnect} cuenta TTLock con token expirado. Ve a{" "}
              <button
                type="button"
                onClick={() => setActiveTab("config")}
                className="underline font-bold"
              >Configuración</button>{" "}
              para reconectar.
            </p>
          </CardContent>
        </Card>
      )}
      {propertiesWithLockIssue.length > 0 && (
        <Card className="rounded-2xl border-orange-200 bg-orange-50">
          <CardContent className="p-4 flex items-center gap-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-orange-600" />
            <p className="text-orange-800">
              {propertiesWithLockIssue.length} propiedad(es) con cerradura pero sin cuenta TTLock asignada.
            </p>
          </CardContent>
        </Card>
      )}

      {/* KPI STRIP */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "En línea", value: online, icon: Wifi, color: "text-green-600 bg-green-50 border-green-100" },
          { label: "Desconectados", value: offline, icon: WifiOff, color: "text-red-600 bg-red-50 border-red-100" },
          { label: "PINs activos", value: activePins, icon: Key, color: "text-primary bg-primary/10 border-primary/20" },
          { label: "Batería baja", value: lowBattery, icon: Battery, color: "text-amber-600 bg-amber-50 border-amber-100" },
        ].map((kpi) => (
          <Card key={kpi.label} className="rounded-2xl border-gray-100 shadow-sm">
            <CardContent className="p-5 flex items-center gap-4">
              <div className={cn("p-2.5 rounded-xl border shrink-0", kpi.color)}>
                <kpi.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-2xl font-black">{kpi.value}</p>
                <p className="text-xs text-muted-foreground font-medium">{kpi.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* TAB NAV */}
      <div className="flex gap-1 bg-muted/50 p-1 rounded-2xl border border-gray-100">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold transition-all",
              activeTab === tab.id ? "bg-white shadow-sm text-primary border border-gray-100" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <tab.icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: DISPOSITIVOS                                                  */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "devices" && (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            {Array.from(new Set(devices.map((d) => d.propertyId))).map((propId) => {
              const propDevices = devices.filter((d) => d.propertyId === propId);
              const propName = propDevices[0]?.propertyName ?? propId;
              return (
                <Card key={propId} className="rounded-2xl border-gray-100 shadow-sm overflow-hidden">
                  <CardHeader className="bg-slate-50/80 border-b pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Home className="h-4 w-4 text-primary" /> {propName}
                      <Badge variant="secondary" className="ml-auto text-[10px]">{propDevices.length} cerradura{propDevices.length !== 1 ? "s" : ""}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 divide-y divide-gray-50">
                    {propDevices.map((device) => {
                      const Icon = DEVICE_ICONS[device.type] ?? Smartphone;
                      const isLock = device.type === "lock_ttlock" || device.type === "lock_tuya";
                      const devicePins = pins.filter(
                        (p) => p.propertyId === device.propertyId && p.status === "active" && !isExpiredPin(p.validTo)
                      );
                      return (
                        <div key={device.id} className="flex items-center gap-4 p-4 hover:bg-slate-50/50 transition-colors">
                          <div className={cn(
                            "p-2.5 rounded-xl border shrink-0",
                            device.online ? "bg-primary/10 border-primary/20" : "bg-gray-100 border-gray-200"
                          )}>
                            <Icon className={cn("h-5 w-5", device.online ? "text-primary" : "text-slate-400")} />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-bold text-sm">{device.name}</h4>
                              <Badge variant="outline" className="text-[8px] tracking-tight bg-white px-1.5 h-3.5 border-slate-200 text-slate-500 uppercase font-black">
                                {device.provider}
                              </Badge>
                              <div className="flex items-center gap-1">
                                <div className={cn("h-1.5 w-1.5 rounded-full animate-pulse", device.online ? "bg-green-500" : "bg-red-400")} />
                                <span className={cn("text-[10px] font-bold", device.online ? "text-green-600" : "text-red-400")}>
                                  {device.online ? "Online" : "Offline"}
                                </span>
                              </div>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                              {DEVICE_LABELS[device.type]}
                              <span className="h-0.5 w-0.5 rounded-full bg-slate-300" />
                              Sinc: {device.lastSync ? new Date(device.lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                            </p>
                            {device.type === "lock_ttlock" && (() => {
                              const gw = gatewayByProp[device.propertyId];
                              if (gw === undefined) return null; // todavia cargando
                              if (gw === null) return null;
                              if (gw.reason === "no_account") {
                                return (
                                  <p className="text-[10px] text-amber-700 mt-0.5 flex items-center gap-1.5 font-bold">
                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                    Gateway: cuenta TTLock no asignada
                                  </p>
                                );
                              }
                              if (gw.reason === "not_linked") {
                                return (
                                  <p className="text-[10px] text-amber-700 mt-0.5 flex items-center gap-1.5 font-bold">
                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                    Cerradura sin gateway vinculado en TTLock
                                  </p>
                                );
                              }
                              if (gw.reason === "no_gateway") {
                                return (
                                  <p className="text-[10px] text-amber-700 mt-0.5 flex items-center gap-1.5 font-bold">
                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                    Sin gateway WiFi asignado
                                  </p>
                                );
                              }
                              if (gw.isOnline) {
                                return (
                                  <p className="text-[10px] text-green-700 mt-0.5 flex items-center gap-1.5 font-bold">
                                    <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                                    {gw.gatewayName ? `${gw.gatewayName} ONLINE` : "Gateway ONLINE"}
                                    {gw.networkName ? <span className="text-muted-foreground font-normal">· WiFi: {gw.networkName}</span> : null}
                                    {gw.signal != null ? <span className="text-muted-foreground font-normal">· {gw.signal} dBm</span> : null}
                                  </p>
                                );
                              }
                              return (
                                <p className="text-[10px] text-red-600 mt-0.5 flex items-center gap-1.5 font-bold">
                                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                                  {gw.gatewayName ? `${gw.gatewayName} OFFLINE` : "Gateway OFFLINE"}
                                  {gw.networkName ? <span className="text-muted-foreground font-normal">· WiFi: {gw.networkName}</span> : null}
                                </p>
                              );
                            })()}
                          </div>

                          <div className="flex items-center gap-3 text-xs shrink-0">
                            {device.battery !== undefined && device.battery !== null && (
                              <div className="flex items-center gap-1">
                                <Battery className={cn("h-3.5 w-3.5", batteryColor(device.battery))} />
                                <span className={cn("font-bold", batteryColor(device.battery))}>{device.battery}%</span>
                              </div>
                            )}
                            {device.temperature !== undefined && (
                              <div className="flex items-center gap-1 text-slate-600">
                                <Thermometer className="h-3.5 w-3.5" />
                                <span className="font-bold">{device.temperature}°C</span>
                              </div>
                            )}
                            {device.humidity !== undefined && (
                              <div className="flex items-center gap-1 text-blue-500">
                                <Droplets className="h-3.5 w-3.5" />
                                <span className="font-bold">{device.humidity}%</span>
                              </div>
                            )}
                            {isLock && (
                              <div className={cn("flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-black", device.locked ? "bg-green-50 border-green-200 text-green-700" : "bg-amber-50 border-amber-200 text-amber-700")}>
                                <Lock className="h-3 w-3" />
                                {device.locked ? "Bloqueada" : "Abierta"}
                              </div>
                            )}
                            {isLock && devicePins.length > 0 && (
                              <div className="flex items-center gap-1 text-[10px] text-primary font-bold">
                                <Key className="h-3 w-3" />
                                {devicePins.length} PIN{devicePins.length > 1 ? "s" : ""}
                              </div>
                            )}
                            {isLock && unlockMsg?.deviceId === device.id && (
                              <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-md", unlockMsg.ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>
                                {unlockMsg.text}
                              </span>
                            )}
                          </div>

                          {isLock && device.provider === "ttlock" && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!device.online || unlockingId === device.id}
                              onClick={() => handleRemoteUnlock(device)}
                              className="h-8 px-3 shrink-0 gap-1.5 border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold text-[11px]"
                              title={device.online ? "Abrir remotamente" : "Requiere gateway/WiFi (Online)"}
                            >
                              {unlockingId === device.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Key className="h-3.5 w-3.5" />
                              )}
                              Abrir
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })}

            {devices.length === 0 && (
              <Card className="border-dashed rounded-2xl">
                <CardContent className="py-16 text-center text-muted-foreground space-y-3">
                  <Smartphone className="h-12 w-12 mx-auto opacity-20" />
                  <p className="font-bold">No hay cerraduras asignadas.</p>
                  <p className="text-sm">Conecta una cuenta TTLock en <button type="button" onClick={() => setActiveTab("config")} className="underline text-primary">Configuración</button> y asigna una cerradura a cada propiedad.</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-5">
            <Card className="rounded-2xl bg-zinc-900 text-white border-none shadow-xl">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <BrainCircuit className="h-5 w-5 text-primary" />
                  <h4 className="font-bold text-sm">Alertas Activas</h4>
                </div>
                <div className="space-y-2">
                  {devices.filter((d) => (d.battery ?? 100) <= 20).map((d) => (
                    <div key={d.id} className="flex items-center gap-2 p-2 rounded-xl bg-red-500/10 border border-red-500/20">
                      <Battery className="h-3.5 w-3.5 text-red-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-bold truncate">{d.name}</p>
                        <p className="text-[9px] text-red-400">{d.battery}% — Cambiar batería pronto</p>
                      </div>
                    </div>
                  ))}
                  {devices.filter((d) => !d.online).map((d) => (
                    <div key={d.id} className="flex items-center gap-2 p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                      <WifiOff className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-bold truncate">{d.name}</p>
                        <p className="text-[9px] text-amber-400">Sin conexión</p>
                      </div>
                    </div>
                  ))}
                  {devices.length > 0 && devices.every((d) => d.online && (d.battery ?? 100) > 20) && (
                    <div className="flex items-center gap-2 p-2 rounded-xl bg-green-500/10 border border-green-500/20">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                      <p className="text-[11px] font-bold text-green-300">Todo en orden</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-gray-100 shadow-sm">
              <CardContent className="p-5 space-y-3">
                <h4 className="font-bold text-sm flex items-center gap-2"><Activity className="h-4 w-4 text-primary" /> Últimos PINs</h4>
                {pins.filter((p) => p.status === "active").slice(0, 4).map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-xs">
                    <div>
                      <p className="font-bold text-slate-800">{p.guestName}</p>
                      <p className="text-muted-foreground">{p.propertyName}</p>
                    </div>
                    <div className="font-mono font-black text-primary text-base">••••</div>
                  </div>
                ))}
                {pins.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">Sin registros aún</p>}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: LLAVES & PINs                                                 */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "pins" && (
        <div className="space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="font-bold text-lg">Llaves de Acceso (PINs)</h3>
              <p className="text-sm text-muted-foreground">
                {activePins} activos · {pins.length} en total
              </p>
            </div>
            <Button
              className="gradient-gold text-primary-foreground gap-2 rounded-xl text-xs"
              onClick={() => { resetPinForm(); setShowPinForm(true); }}
            >
              <Plus className="h-3.5 w-3.5" /> Crear PIN manual
            </Button>
          </div>

          {/* Create PIN form */}
          {showPinForm && (
            <Card className="rounded-2xl border-primary/20 bg-primary/5 shadow-sm">
              <CardContent className="p-5 space-y-4">
                <h4 className="font-bold flex items-center gap-2 text-sm">
                  <Key className="h-4 w-4 text-primary" /> {editingPinId ? "Editar PIN" : "Nuevo PIN de Acceso"}
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-black uppercase tracking-wider text-slate-500">Propiedad</Label>
                    <Select value={pinForm.propertyId} onValueChange={(v) => setPinForm((f) => ({ ...f, propertyId: v }))}>
                      <SelectTrigger className="rounded-xl"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                      <SelectContent>
                        {properties.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}{p.ttlock_lock_id ? " · 🔒" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-black uppercase tracking-wider text-slate-500">Nombre Huésped</Label>
                    <Input placeholder="Ana García" value={pinForm.guestName} onChange={(e) => setPinForm((f) => ({ ...f, guestName: e.target.value }))} className="rounded-xl" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-black uppercase tracking-wider text-slate-500">Teléfono (opcional)</Label>
                    <Input placeholder="+56 9 1234 5678" value={pinForm.guestPhone} onChange={(e) => setPinForm((f) => ({ ...f, guestPhone: e.target.value }))} className="rounded-xl" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-black uppercase tracking-wider text-slate-500">PIN (4-8 dígitos)</Label>
                    <Input placeholder="5678" maxLength={8} value={pinForm.pin} onChange={(e) => setPinForm((f) => ({ ...f, pin: e.target.value.replace(/\D/g, "") }))} className="rounded-xl font-mono font-bold text-lg tracking-widest" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-black uppercase tracking-wider text-slate-500">Válido desde</Label>
                    <Input type="datetime-local" value={pinForm.validFrom} onChange={(e) => setPinForm((f) => ({ ...f, validFrom: e.target.value }))} className="rounded-xl" aria-label="Válido desde" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-black uppercase tracking-wider text-slate-500">Válido hasta</Label>
                    <Input type="datetime-local" value={pinForm.validTo} onChange={(e) => setPinForm((f) => ({ ...f, validTo: e.target.value }))} className="rounded-xl" aria-label="Válido hasta" />
                  </div>
                </div>
                {pinError && <p className="text-xs text-red-600 font-bold">{pinError}</p>}
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" className="flex-1 rounded-xl" onClick={() => { setShowPinForm(false); resetPinForm(); }}>Cancelar</Button>
                  <Button
                    className="flex-1 gradient-gold text-primary-foreground rounded-xl border-none"
                    onClick={handleCreatePin}
                    disabled={pinSaving}
                  >
                    {pinSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : (editingPinId ? "Guardar cambios" : "Crear PIN")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* PIN list */}
          <div className="space-y-3">
            {pins.length === 0 && (
              <Card className="border-dashed rounded-2xl">
                <CardContent className="py-16 text-center text-muted-foreground space-y-3">
                  <Key className="h-12 w-12 mx-auto opacity-20" />
                  <p className="font-bold">No hay PINs generados aún.</p>
                  <p className="text-sm">Agrega feeds iCal o crea un PIN manual.</p>
                </CardContent>
              </Card>
            )}
            {pins.map((pin) => {
              const expired = isExpiredPin(pin.validTo);
              const inactive = pin.status === "revoked" || expired;
              const sourceColors: Record<string, string> = {
                airbnb_ical: "bg-rose-500",
                vrbo_ical: "bg-blue-500",
                direct_booking: "bg-emerald-500",
                manual: "bg-slate-400",
              };
              const sourceLabels: Record<string, string> = {
                airbnb_ical: "Airbnb iCal",
                vrbo_ical: "VRBO iCal",
                direct_booking: "Reserva Directa",
                manual: "Manual",
              };
              return (
                <div key={pin.id} className={cn(
                  "border rounded-2xl p-4 bg-white shadow-sm transition-all",
                  inactive ? "opacity-50 border-dashed" : "hover:shadow-md"
                )}>
                  <div className="flex items-start gap-4">
                    <div className={cn("flex flex-col items-center justify-center px-4 py-3 rounded-xl border-2 min-w-[80px]", inactive ? "border-slate-200 bg-slate-50" : "border-primary/30 bg-primary/5")}>
                      <p className="text-[9px] font-black uppercase text-muted-foreground tracking-wider mb-1">PIN</p>
                      <p className={cn("text-2xl font-black tracking-widest font-mono", inactive ? "text-slate-400" : "text-primary")}>{pin.pin}</p>
                    </div>

                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900">{pin.guestName}</span>
                        <Badge className={cn("text-[9px] border-none h-4 text-white", sourceColors[pin.source] ?? "bg-slate-400")}>
                          {sourceLabels[pin.source] ?? pin.source}
                        </Badge>
                        {pin.status === "revoked" && <Badge variant="secondary" className="text-[9px]">Revocado</Badge>}
                        {expired && pin.status !== "revoked" && <Badge variant="secondary" className="text-[9px] text-red-500">Expirado</Badge>}
                        {!inactive && <Badge className="text-[9px] bg-green-500 text-white border-none h-4">Activo</Badge>}
                        {pin.ttlockPwdId && <Badge className="text-[9px] bg-blue-500 text-white border-none h-4">En cerradura</Badge>}
                      </div>
                      <p className="text-[11px] text-muted-foreground font-medium">{pin.propertyName}</p>
                      <div className="flex items-center gap-3 text-[10px] text-slate-500 flex-wrap">
                        <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" /> {formatDateTime(pin.validFrom)}</span>
                        <span>→</span>
                        <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" /> {formatDateTime(pin.validTo)}</span>
                        {pin.guestPhone && <span className="flex items-center gap-0.5"><Phone className="h-3 w-3" /> {pin.guestPhone}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={() => navigator.clipboard.writeText(pin.pin)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-primary transition-colors" title="Copiar PIN">
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      {!inactive && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingPinId(pin.id);
                            setPinForm({
                              propertyId: pin.propertyId,
                              guestName: pin.guestName,
                              guestPhone: pin.guestPhone ?? "",
                              pin: pin.pin,
                              // Convertir ISO (UTC) → "YYYY-MM-DDTHH:MM" en la
                              // zona local del navegador. Antes se cortaba a
                              // 16 chars, metiendo la hora UTC al input.
                              validFrom: isoToLocalInput(pin.validFrom),
                              validTo: isoToLocalInput(pin.validTo),
                            });
                            setShowPinForm(true);
                          }}
                          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-primary transition-colors"
                          title="Editar PIN"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {!inactive && !pin.ttlockPwdId && (() => {
                        const prop = properties.find((p) => p.id === pin.propertyId);
                        if (!prop?.ttlock_account_id || !prop.ttlock_lock_id) return null;
                        return (
                          <button
                            type="button"
                            onClick={() => handleReprogramPin(pin)}
                            disabled={reprogrammingId === pin.id}
                            className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors disabled:opacity-50"
                            title="Programar este PIN en la cerradura"
                          >
                            {reprogrammingId === pin.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Zap className="h-3.5 w-3.5" />
                            )}
                          </button>
                        );
                      })()}
                      {!inactive && (
                        <button
                          type="button"
                          onClick={() => handleRevokePin(pin)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                          title="Revocar PIN"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeletePin(pin)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                        title="Eliminar permanentemente"
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {reprogramMsg?.pinId === pin.id && (
                    <div
                      className={cn(
                        "mt-2 text-xs rounded-md px-2 py-1.5 border",
                        reprogramMsg.ok
                          ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                          : "bg-red-50 text-red-700 border-red-200"
                      )}
                    >
                      {reprogramMsg.text}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: iCAL & ACCESO AUTOMÁTICO                                      */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "ical" && (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">
            <div>
              <h3 className="font-bold">Feeds iCal por Propiedad</h3>
              <p className="text-sm text-muted-foreground">Se heredan automáticamente del iCal configurado en cada propiedad (Airbnb / VRBO)</p>
            </div>

            {/* Show ALL properties with their iCal status */}
            {properties.length === 0 && (
              <Card className="border-dashed rounded-2xl">
                <CardContent className="py-16 text-center text-muted-foreground space-y-3">
                  <Calendar className="h-12 w-12 mx-auto opacity-20" />
                  <p className="font-bold">No hay propiedades registradas.</p>
                  <p className="text-sm">Agrega una propiedad con su URL de iCal en el panel de Propiedades.</p>
                </CardContent>
              </Card>
            )}

            {properties.map((p) => {
              const airbnbConfig = icalConfigs.find((c) => c.propertyId === p.id && c.channel === "airbnb");
              const vrboConfig = icalConfigs.find((c) => c.propertyId === p.id && c.channel === "vrbo");
              const hasAny = !!airbnbConfig || !!vrboConfig;

              return (
                <Card key={p.id} className={cn("rounded-2xl shadow-sm overflow-hidden", hasAny ? "border-gray-100" : "border-dashed border-amber-200")}>
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-sm">{p.name}</h4>
                      {!hasAny && (
                        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Sin iCal — configúralo en Propiedades</span>
                      )}
                    </div>

                    {/* Airbnb feed */}
                    {airbnbConfig ? (
                      <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-rose-50/50 border border-rose-100">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-7 h-7 rounded-lg bg-rose-500 flex items-center justify-center text-white text-[10px] font-black shrink-0">AI</div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold">Airbnb</p>
                            <p className="text-[10px] text-muted-foreground font-mono truncate max-w-[320px]">{airbnbConfig.url}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button size="sm" variant="outline" className="rounded-lg text-[10px] h-7 px-2 gap-1" onClick={() => handleSyncIcal(airbnbConfig)} disabled={syncingIcalId === airbnbConfig.id}>
                            <RefreshCw className={cn("h-3 w-3", syncingIcalId === airbnbConfig.id && "animate-spin")} />
                            Sync
                          </Button>
                          <Button size="sm" variant="outline" className="rounded-lg text-[10px] h-7 px-2 border-red-200 text-red-500 hover:bg-red-50" onClick={() => handleRemoveIcal(airbnbConfig)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-dashed border-gray-200">
                        <div className="w-7 h-7 rounded-lg bg-gray-300 flex items-center justify-center text-white text-[10px] font-black shrink-0">AI</div>
                        <p className="text-xs text-muted-foreground">Airbnb — sin iCal configurado</p>
                      </div>
                    )}

                    {/* VRBO feed */}
                    {vrboConfig ? (
                      <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-blue-50/50 border border-blue-100">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center text-white text-[10px] font-black shrink-0">VR</div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold">VRBO</p>
                            <p className="text-[10px] text-muted-foreground font-mono truncate max-w-[320px]">{vrboConfig.url}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button size="sm" variant="outline" className="rounded-lg text-[10px] h-7 px-2 gap-1" onClick={() => handleSyncIcal(vrboConfig)} disabled={syncingIcalId === vrboConfig.id}>
                            <RefreshCw className={cn("h-3 w-3", syncingIcalId === vrboConfig.id && "animate-spin")} />
                            Sync
                          </Button>
                          <Button size="sm" variant="outline" className="rounded-lg text-[10px] h-7 px-2 border-red-200 text-red-500 hover:bg-red-50" onClick={() => handleRemoveIcal(vrboConfig)}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-dashed border-gray-200">
                        <div className="w-7 h-7 rounded-lg bg-gray-300 flex items-center justify-center text-white text-[10px] font-black shrink-0">VR</div>
                        <p className="text-xs text-muted-foreground">VRBO — sin iCal configurado</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Sidebar */}
          <div className="space-y-5">
            <Card className="rounded-2xl bg-zinc-900 text-white border-none shadow-xl">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <BrainCircuit className="h-5 w-5 text-primary" />
                  <h4 className="font-bold text-sm">¿Cómo funciona?</h4>
                </div>
                <div className="space-y-3">
                  {[
                    { step: "1", text: "Airbnb incluye los últimos 4 dígitos del teléfono del huésped en el iCal (DESCRIPTION del evento)" },
                    { step: "2", text: "StayHost parsea el feed automáticamente y extrae: nombre, fechas y esos 4 dígitos" },
                    { step: "3", text: "Se puede crear un PIN en TTLock = esos 4 dígitos, válido desde check-in hasta check-out" },
                    { step: "4", text: "Todos los PINs se guardan en la base de datos (no en el navegador)" },
                  ].map((s) => (
                    <div key={s.step} className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-black text-primary shrink-0 mt-0.5">{s.step}</div>
                      <p className="text-[11px] text-zinc-300 leading-relaxed">{s.text}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-amber-200 bg-amber-50 shadow-sm">
              <CardContent className="p-5 space-y-2">
                <h4 className="font-bold text-sm text-amber-800 flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> VRBO</h4>
                <p className="text-[11px] text-amber-700 leading-relaxed">VRBO puede no incluir el teléfono en su iCal según configuración del anuncio. En ese caso el PIN debe crearse manualmente.</p>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-gray-100 shadow-sm">
              <CardContent className="p-5 space-y-3">
                <h4 className="font-bold text-sm flex items-center gap-2"><BookOpen className="h-4 w-4 text-primary" /> Cómo obtener el iCal</h4>
                <ol className="text-[11px] text-slate-600 space-y-2 list-decimal list-inside leading-relaxed">
                  <li>Airbnb: <strong>Anuncios → Disponibilidad → Sincronizar calendarios → Exportar</strong></li>
                  <li>VRBO: <strong>Anuncios → Calendario → Importar/Exportar → Exportar</strong></li>
                  <li>Copia la URL <strong>.ics</strong> y pégala arriba</li>
                </ol>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TAB: CONFIGURACIÓN                                                 */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {activeTab === "config" && (
        <div className="space-y-6">
          <TTLockAccountsSection />

          <Card className="rounded-2xl border-gray-100 bg-zinc-950 text-zinc-300">
            <CardContent className="p-5 space-y-3">
              <h4 className="font-bold text-white text-sm flex items-center gap-2">
                <Settings className="h-4 w-4 text-primary" /> Credenciales de servidor
              </h4>
              <p className="text-[11px] text-zinc-400">
                Las API keys maestras se leen de variables de entorno en Vercel/Netlify.
                No se guardan en el navegador ni en la base de datos del cliente.
              </p>
              <div className="bg-zinc-900 rounded-xl p-4 font-mono text-[10px] text-green-400 space-y-1">
                <p># TTLock (app master credentials)</p>
                <p>TTLOCK_CLIENT_ID=tu_client_id</p>
                <p>TTLOCK_CLIENT_SECRET=tu_client_secret</p>
                <p className="mt-2"># Tuya</p>
                <p>TUYA_CLIENT_ID=tu_access_id</p>
                <p>TUYA_CLIENT_SECRET=tu_access_secret</p>
                <p>TUYA_REGION=eu</p>
                <p>TUYA_UID=tu_uid</p>
              </div>
              <p className="text-[10px] text-zinc-500">
                Las cuentas TTLock individuales se guardan por tenant en la tabla{" "}
                <code className="bg-zinc-800 px-1 rounded">ttlock_accounts</code> (arriba).
                Los PINs persisten en <code className="bg-zinc-800 px-1 rounded">access_pins</code>.
              </p>
            </CardContent>
          </Card>

          <div className="pt-6 border-t border-red-100">
            <h4 className="text-sm font-black text-red-600 uppercase tracking-widest mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Zona de Peligro
            </h4>
            <p className="text-xs text-slate-500 mb-4">
              Borra el caché local heredado (credenciales del Import Wizard). No toca cuentas TTLock ni propiedades ni PINs.
            </p>
            <Button
              variant="outline"
              className="rounded-xl font-bold border-slate-200 text-slate-500 hover:bg-slate-50 h-11 px-6"
              onClick={() => {
                if (confirm("¿Limpiar caché local heredado?")) {
                  localStorage.removeItem("stayhost_smart_devices");
                  localStorage.removeItem("stayhost_pins");
                  localStorage.removeItem("stayhost_ical_configs");
                  localStorage.removeItem("stayhost_integrations");
                  window.location.reload();
                }
              }}
            >
              <RefreshCw className="h-4 w-4 mr-2" /> Limpiar caché local
            </Button>
          </div>
        </div>
      )}

      {/* Import wizard modal (legacy path, keeps working with its own creds) */}
      <ImportWizardDialog
        open={showImportWizard}
        onOpenChange={setShowImportWizard}
        integrations={integrations}
        setIntegrations={setIntegrations}
        properties={properties.map((p) => ({ id: p.id, name: p.name }))}
        onDevicesImported={() => { void refreshAll(); }}
      />

    </div>
  );
}
