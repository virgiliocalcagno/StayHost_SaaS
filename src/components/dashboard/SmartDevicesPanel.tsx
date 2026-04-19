"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Smartphone, Lock, Thermometer, Wifi, WifiOff, Key, Plus, RefreshCw,
  Settings, Battery, CheckCircle2, AlertCircle, BrainCircuit, Zap,
  Trash2, Clock, Copy, ExternalLink, Link2, ShieldCheck,
  Droplets, Wind, Eye, EyeOff, Loader2, Calendar, Phone, Home,
  PlugZap, ChevronRight, X, ToggleLeft, ToggleRight, BookOpen,
  Activity, AlertTriangle, Star, Shield, Edit3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { parseICalFeed, type ParsedICalBooking } from "@/utils/icalParser";
import { useModules } from "@/context/ModuleContext";
import TTLockAccountsSection from "./smart-devices/TTLockAccountsSection";
import ImportWizardDialog from "./smart-devices/ImportWizardDialog";
import type {
  DeviceType,
  TabType,
  SmartDevice,
  AccessPin,
  ICalConfig,
  Integrations,
  DirectBooking,
  Property,
} from "./smart-devices/types";
import {
  DEVICE_ICONS,
  DEVICE_LABELS,
  CHANNEL_LABELS,
  CHANNEL_COLORS,
  batteryColor,
  batteryBg,
  isExpiredPin,
  formatDate,
  formatDateTime,
} from "./smart-devices/utils";

// ——— Component ————————————————————————————————————————————————

export default function SmartDevicesPanel() {
  const { userRole } = useModules();
  const [activeTab, setActiveTab] = useState<TabType>("devices");
  const isAdminMode = userRole === "OWNER";

  // Import Wizard (el estado interno vive en ImportWizardDialog)
  const [showImportWizard, setShowImportWizard] = useState(false);

  // ── State ──────────────────────────────────────────────────────────────────
  const [devices, setDevices] = useState<SmartDevice[]>(() => {
    if (typeof window === "undefined") return [];
    try { 
      const r = localStorage.getItem("stayhost_smart_devices");
      const list = r ? JSON.parse(r) : [];
      // Auto-limpieza si detectamos dispositivos demo antiguos (id: d1, d2...)
      if (list.length > 0 && list.some((d: any) => d.id && /^d[1-6]$/.test(d.id))) {
        return [];
      }
      return list;
    } catch { return []; }
  });

  const [pins, setPins] = useState<AccessPin[]>(() => {
    if (typeof window === "undefined") return [];
    try { const r = localStorage.getItem("stayhost_pins"); return r ? JSON.parse(r) : []; } catch { return []; }
  });

  const [icalConfigs, setIcalConfigs] = useState<ICalConfig[]>(() => {
    if (typeof window === "undefined") return [];
    try { const r = localStorage.getItem("stayhost_ical_configs"); return r ? JSON.parse(r) : []; } catch { return []; }
  });

  const [integrations, setIntegrations] = useState<Integrations>(() => {
    if (typeof window === "undefined") return { tuya: { clientId: "", clientSecret: "", region: "eu", uid: "" }, ttlock: { clientId: "", clientSecret: "", username: "", password: "" } };
    try { const r = localStorage.getItem("stayhost_integrations"); return r ? JSON.parse(r) : { tuya: { clientId: "", clientSecret: "", region: "eu", uid: "" }, ttlock: { clientId: "", clientSecret: "", username: "", password: "" } }; } catch { return { tuya: { clientId: "", clientSecret: "", region: "eu", uid: "" }, ttlock: { clientId: "", clientSecret: "", username: "", password: "" } }; }
  });

  const [properties, setProperties] = useState<Property[]>([]);
  const [directBookings, setDirectBookings] = useState<DirectBooking[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncingIcalId, setSyncingIcalId] = useState<string | null>(null);
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [unlockMsg, setUnlockMsg] = useState<{ deviceId: string; text: string; ok: boolean } | null>(null);

  // Pin creation form
  const [showPinForm, setShowPinForm] = useState(false);
  const [pinForm, setPinForm] = useState({ deviceId: "", guestName: "", pin: "", validFrom: "", validTo: "", source: "manual" as AccessPin["source"] });
  const [pinCreating, setPinCreating] = useState(false);
  const [editingPinId, setEditingPinId] = useState<string | null>(null);

  // iCal form
  const [showIcalForm, setShowIcalForm] = useState(false);
  const [icalForm, setIcalForm] = useState({ propertyId: "", propertyName: "", channel: "airbnb" as ICalConfig["channel"], url: "", autoGeneratePins: true, targetDeviceId: "" });

  // Config show/hide secrets

  // Persist
  useEffect(() => { localStorage.setItem("stayhost_smart_devices", JSON.stringify(devices)); }, [devices]);
  useEffect(() => { localStorage.setItem("stayhost_pins", JSON.stringify(pins)); }, [pins]);
  useEffect(() => { localStorage.setItem("stayhost_ical_configs", JSON.stringify(icalConfigs)); }, [icalConfigs]);
  useEffect(() => { localStorage.setItem("stayhost_integrations", JSON.stringify(integrations)); }, [integrations]);


  useEffect(() => {
    try {
      const rp = localStorage.getItem("stayhost_properties");
      if (rp) {
        const parsed = JSON.parse(rp);
        setProperties(parsed.map((p: any) => ({ 
          id: p.id, 
          name: p.name,
          channels: p.channels || []
        })));
      }
      const rb = localStorage.getItem("stayhost_direct_bookings");
      if (rb) setDirectBookings(JSON.parse(rb));
    } catch { /* ignore */ }
  }, []);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const online = devices.filter(d => d.online).length;
  const offline = devices.filter(d => !d.online).length;
  const lowBattery = devices.filter(d => (d.battery ?? 100) <= 20).length;
  const activePins = pins.filter(p => p.status === "active" && !isExpiredPin(p.validTo)).length;

  // ── PIN Auto-generate from iCal booking ───────────────────────────────────
  const autoGeneratePin = useCallback((
    booking: ParsedICalBooking,
    config: ICalConfig,
    lockDevice: SmartDevice
  ) => {
    if (!booking.phoneLast4) return null;

    // Check if pin already exists for this booking
    const exists = pins.find(p => p.bookingRef === booking.uid);
    if (exists) return null;

    const newPin: AccessPin = {
      id: `pin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      deviceId: lockDevice.id,
      deviceName: lockDevice.name,
      propertyId: config.propertyId,
      propertyName: config.propertyName,
      guestName: booking.guestName,
      pin: booking.phoneLast4,
      source: booking.channel === "airbnb" ? "airbnb_ical" : booking.channel === "vrbo" ? "vrbo_ical" : "airbnb_ical",
      bookingRef: booking.uid,
      validFrom: `${booking.checkin}T14:00:00`,   // Checkin at 2pm
      validTo: `${booking.checkout}T12:00:00`,     // Checkout at noon
      status: "active",
      createdAt: new Date().toISOString(),
    };

    return newPin;
  }, [pins]);

  // ── Helper: Program hardware lock ────────────────────────────────────────
  const programHardwarePin = async (pin: AccessPin, device: SmartDevice) => {
    if (device.provider === "ttlock" && integrations.ttlock.accessToken) {
      try {
        const res = await fetch("/api/ttlock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "createPin",
            accessToken: integrations.ttlock.accessToken,
            lockId: device.remoteId,
            keyboard_pwd: pin.pin,
            startDate: new Date(pin.validFrom).getTime(),
            endDate: new Date(pin.validTo).getTime(),
            credentials: {
              clientId: integrations.ttlock.clientId,
              clientSecret: integrations.ttlock.clientSecret
            }
          }),
        });
        const data = await res.json() as { keyboardPwdId?: string };
        if (data.keyboardPwdId) return data.keyboardPwdId;
      } catch (e) {
        console.error("Hardware programming error:", e);
      }
    }
    return undefined;
  };

  // ── Remote unlock ────────────────────────────────────────────────────────
  // Opens the lock via TTLock's /v3/lock/unlock. Only works if the lock has
  // a gateway (G2/G3) or WiFi module — pure bluetooth locks return errcode
  // -2012 ("no gateway"). We surface that back to the user.
  const handleRemoteUnlock = async (device: SmartDevice) => {
    if (device.provider !== "ttlock") {
      setUnlockMsg({ deviceId: device.id, text: "Solo soportado en TTLock por ahora", ok: false });
      return;
    }
    if (!integrations.ttlock.accessToken) {
      setUnlockMsg({ deviceId: device.id, text: "Conecta una cuenta TTLock primero", ok: false });
      return;
    }
    setUnlockingId(device.id);
    setUnlockMsg(null);
    try {
      const res = await fetch("/api/ttlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remoteUnlock",
          accessToken: integrations.ttlock.accessToken,
          lockId: device.remoteId,
        }),
      });
      const data = (await res.json()) as { errcode?: number; errmsg?: string; error?: string };
      if (data.errcode === 0) {
        setUnlockMsg({ deviceId: device.id, text: "Abierta", ok: true });
        setDevices(prev => prev.map(d => d.id === device.id ? { ...d, locked: false } : d));
      } else {
        setUnlockMsg({
          deviceId: device.id,
          text: data.errmsg ?? data.error ?? `Error ${data.errcode ?? ""}`.trim(),
          ok: false,
        });
      }
    } catch (e) {
      setUnlockMsg({ deviceId: device.id, text: String(e), ok: false });
    } finally {
      setUnlockingId(null);
      setTimeout(() => setUnlockMsg(m => m?.deviceId === device.id ? null : m), 4000);
    }
  };

  // ── Sync iCal ─────────────────────────────────────────────────────────────
  const syncIcal = useCallback(async (config: ICalConfig) => {
    setSyncingIcalId(config.id);
    try {
      const res = await fetch("/api/ical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: config.url }),
      });
      const { ical, error } = await res.json() as { ical?: string; error?: string };
      if (error || !ical) throw new Error(error ?? "No data");

      const bookings = parseICalFeed(ical, config.url);
      const newPins: AccessPin[] = [];

      if (config.autoGeneratePins && config.targetDeviceId) {
        const lockDevice = devices.find(d => d.id === config.targetDeviceId);
        if (lockDevice) {
          for (const booking of bookings) {
            const pin = autoGeneratePin(booking, config, lockDevice);
            if (pin) {
              const hardwareId = await programHardwarePin(pin, lockDevice);
              if (hardwareId) pin.ttlockPwdId = hardwareId;
              newPins.push(pin);
            }
          }
        }
      }

      setIcalConfigs(prev => prev.map(c => c.id === config.id
        ? { ...c, bookings, lastSync: new Date().toISOString() }
        : c
      ));

      if (newPins.length > 0) {
        setPins(prev => [...prev, ...newPins]);
      }
    } catch (err) {
      console.error("iCal Sync Error:", err);
    } finally {
      setSyncingIcalId(null);
    }
  }, [devices, autoGeneratePin, integrations, pins]);

  // ── Auto-generate PINs from direct bookings ───────────────────────────────
  const generatePinFromDirectBooking = async (booking: DirectBooking) => {
    if (!booking.guestPhone) return;
    const digits = booking.guestPhone.replace(/\D/g, "");
    const pinVal = digits.slice(-4);
    if (!pinVal || pinVal.length < 4) return;

    const propDevices = devices.filter(d => d.propertyId === booking.propertyId && (d.provider === "ttlock" || d.provider === "tuya"));
    if (propDevices.length === 0) return;

    const exists = pins.find(p => p.bookingRef === booking.id);
    if (exists) return;

    const createdPins: AccessPin[] = [];
    for (const device of propDevices) {
      const newPin: AccessPin = {
        id: `pin-direct-${booking.id}-${device.id}`,
        deviceId: device.id,
        deviceName: device.name,
        propertyId: booking.propertyId,
        propertyName: booking.propertyName,
        guestName: booking.guestName,
        guestPhone: booking.guestPhone,
        pin: pinVal,
        source: "direct_booking",
        bookingRef: booking.id,
        validFrom: `${booking.checkin}T14:00:00`,
        validTo: `${booking.checkout}T12:00:00`,
        status: "active",
        createdAt: new Date().toISOString(),
      };

      const hardwareId = await programHardwarePin(newPin, device);
      if (hardwareId) newPin.ttlockPwdId = hardwareId;
      createdPins.push(newPin);
    }

    if (createdPins.length > 0) {
      setPins(prev => [...prev, ...createdPins]);
    }
  };

  // ── Manual PIN creation ────────────────────────────────────────────────────
  const handleCreatePin = async () => {
    if (!pinForm.deviceId || !pinForm.guestName || !pinForm.pin || !pinForm.validFrom || !pinForm.validTo) return;
    
    if (editingPinId) {
      const oldPin = pins.find(p => p.id === editingPinId);
      if (oldPin) {
        await handleUpdatePin(oldPin, pinForm);
        return;
      }
    }

    setPinCreating(true);

    const device = devices.find(d => d.id === pinForm.deviceId);
    const newPin: AccessPin = {
      id: `pin-manual-${Date.now()}`,
      deviceId: pinForm.deviceId,
      deviceName: device?.name ?? "Dispositivo",
      propertyId: device?.propertyId ?? "",
      propertyName: device?.propertyName ?? "",
      guestName: pinForm.guestName,
      pin: pinForm.pin,
      source: "manual",
      validFrom: pinForm.validFrom,
      validTo: pinForm.validTo,
      status: "active",
      createdAt: new Date().toISOString(),
    };

    // If TTLock device, call API
    if (device?.provider === "ttlock" && integrations.ttlock.accessToken) {
      try {
        const res = await fetch("/api/ttlock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "createPin",
            accessToken: integrations.ttlock.accessToken,
            lockId: device.remoteId,
            keyboard_pwd: pinForm.pin,
            startDate: new Date(pinForm.validFrom).getTime(),
            endDate: new Date(pinForm.validTo).getTime(),
          }),
        });
        const data = await res.json() as { keyboardPwdId?: string; mock?: boolean };
        if (data.keyboardPwdId) newPin.ttlockPwdId = data.keyboardPwdId;
      } catch { /* continue anyway */ }
    }

    setPins(prev => [newPin, ...prev]);
    setShowPinForm(false);
    setPinForm({ deviceId: "", guestName: "", pin: "", validFrom: "", validTo: "", source: "manual" });
    setPinCreating(false);
  };

  const handleUpdatePin = async (oldPin: AccessPin, newData: typeof pinForm) => {
    setPinCreating(true);
    // 1. Revoke old pin from hardware
    if (oldPin.ttlockPwdId && integrations.ttlock.accessToken) {
      const device = devices.find(d => d.id === oldPin.deviceId);
      if (device?.provider === "ttlock") {
        try {
          await fetch("/api/ttlock", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              action: "deletePin", 
              accessToken: integrations.ttlock.accessToken, 
              lockId: device.remoteId, 
              keyboardPwdId: oldPin.ttlockPwdId,
              credentials: {
                clientId: integrations.ttlock.clientId,
                clientSecret: integrations.ttlock.clientSecret
              }
            }),
          });
        } catch { /* ignore */ }
      }
    }
    
    // 2. Create new pin in hardware
    const device = devices.find(d => d.id === newData.deviceId);
    const newPin: AccessPin = {
      ...oldPin,
      deviceId: newData.deviceId,
      deviceName: device?.name ?? "Dispositivo",
      propertyId: device?.propertyId ?? "",
      propertyName: device?.propertyName ?? "",
      guestName: newData.guestName,
      pin: newData.pin,
      validFrom: newData.validFrom,
      validTo: newData.validTo,
      status: "active",
      ttlockPwdId: undefined, 
    };

    if (device) {
      const hardwareId = await programHardwarePin(newPin, device);
      if (hardwareId) newPin.ttlockPwdId = hardwareId;
    }

    setPins(prev => prev.map(p => p.id === oldPin.id ? newPin : p));
    setShowPinForm(false);
    setEditingPinId(null);
    setPinForm({ deviceId: "", guestName: "", pin: "", validFrom: "", validTo: "", source: "manual" });
    setPinCreating(false);
  };

  const handleRevokePin = async (pin: AccessPin) => {
    // If TTLock, delete from lock
    if (pin.ttlockPwdId && integrations.ttlock.accessToken) {
      const device = devices.find(d => d.id === pin.deviceId);
      if (device?.provider === "ttlock") {
        try {
          await fetch("/api/ttlock", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "deletePin", accessToken: integrations.ttlock.accessToken, lockId: device.remoteId, keyboardPwdId: pin.ttlockPwdId }),
          });
        } catch { /* ignore */ }
      }
    }
    setPins(prev => prev.map(p => p.id === pin.id ? { ...p, status: "revoked" } : p));
  };

  // ── Sync all devices ───────────────────────────────────────────────────────
  const handleSyncAll = async () => {
    setSyncing(true);
    await new Promise(r => setTimeout(r, 1200)); // Simulate API call
    setDevices(prev => prev.map(d => ({ ...d, lastSync: new Date().toISOString() })));
    setSyncing(false);
  };

  // ── Add iCal config ────────────────────────────────────────────────────────
  const handleAddIcal = async () => {
    const prop = properties.find(p => p.id === icalForm.propertyId);
    const newConfig: ICalConfig = {
      id: `ical-${Date.now()}`,
      propertyId: icalForm.propertyId,
      propertyName: prop?.name ?? icalForm.propertyName,
      channel: icalForm.channel,
      url: icalForm.url,
      autoGeneratePins: icalForm.autoGeneratePins,
      targetDeviceId: icalForm.targetDeviceId,
    };
    setIcalConfigs(prev => [newConfig, ...prev]);
    setShowIcalForm(false);
    setIcalForm({ propertyId: "", propertyName: "", channel: "airbnb", url: "", autoGeneratePins: true, targetDeviceId: "" });
    
    // Sync immediately
    await syncIcal(newConfig);
  };

  const lockDevices = devices.filter(d => d.type === "lock_ttlock" || d.type === "lock_tuya");

  const tabs: { id: TabType; label: string; icon: React.ElementType }[] = [
    { id: "devices", label: "Dispositivos", icon: Smartphone },
    { id: "pins", label: "Llaves & PINs", icon: Key },
    { id: "ical", label: "iCal & Acceso", icon: Calendar },
    ...(isAdminMode ? [{ id: "config" as TabType, label: "Configuración", icon: Settings }] : []),
  ];

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 pb-20">

      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Dispositivos Inteligentes</h2>
          <p className="text-muted-foreground">Tuya · TTLock · iCal automático · PINs por reserva</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" className="gap-2" onClick={handleSyncAll} disabled={syncing}>
            <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
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

      {/* KPI STRIP */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "En línea", value: online, icon: Wifi, color: "text-green-600 bg-green-50 border-green-100" },
          { label: "Desconectados", value: offline, icon: WifiOff, color: "text-red-600 bg-red-50 border-red-100" },
          { label: "PINs activos", value: activePins, icon: Key, color: "text-primary bg-primary/10 border-primary/20" },
          { label: "Batería baja", value: lowBattery, icon: Battery, color: "text-amber-600 bg-amber-50 border-amber-100" },
        ].map(kpi => (
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
        {tabs.map(tab => (
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

            {Array.from(new Set(devices.map(d => d.propertyId))).map(propId => {
              const propDevices = devices.filter(d => d.propertyId === propId);
              const propName = propDevices[0]?.propertyName ?? propId;
              return (
                <Card key={propId} className="rounded-2xl border-gray-100 shadow-sm overflow-hidden">
                  <CardHeader className="bg-slate-50/80 border-b pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Home className="h-4 w-4 text-primary" /> {propName}
                      <Badge variant="secondary" className="ml-auto text-[10px]">{propDevices.length} dispositivos</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 divide-y divide-gray-50">
                    {propDevices.map(device => {
                      const Icon = DEVICE_ICONS[device.type] ?? Smartphone;
                      const isLock = device.type === "lock_ttlock" || device.type === "lock_tuya";
                      const devicePins = pins.filter(p => p.deviceId === device.id && p.status === "active" && !isExpiredPin(p.validTo));
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
                              Sinc: {device.lastSync ? new Date(device.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                            </p>
                          </div>

                          {/* Readings */}
                          <div className="flex items-center gap-3 text-xs shrink-0">
                            {device.battery !== undefined && (
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

                          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                            <Settings className="h-3.5 w-3.5" />
                          </Button>
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
                  <p className="font-bold">No hay dispositivos registrados.</p>
                  <p className="text-sm">Configura Tuya o TTLock en la pestaña "Configuración" y luego sincroniza.</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar: Low battery + Alerts */}
          <div className="space-y-5">
            <Card className="rounded-2xl bg-zinc-900 text-white border-none shadow-xl">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <BrainCircuit className="h-5 w-5 text-primary" />
                  <h4 className="font-bold text-sm">Alertas Activas</h4>
                </div>
                <div className="space-y-2">
                  {devices.filter(d => (d.battery ?? 100) <= 20).map(d => (
                    <div key={d.id} className="flex items-center gap-2 p-2 rounded-xl bg-red-500/10 border border-red-500/20">
                      <Battery className="h-3.5 w-3.5 text-red-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-bold truncate">{d.name}</p>
                        <p className="text-[9px] text-red-400">{d.battery}% — Cambiar batería pronto</p>
                      </div>
                    </div>
                  ))}
                  {devices.filter(d => !d.online).map(d => (
                    <div key={d.id} className="flex items-center gap-2 p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                      <WifiOff className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-bold truncate">{d.name}</p>
                        <p className="text-[9px] text-amber-400">Sin conexión · {formatDateTime(d.lastSync ?? "")}</p>
                      </div>
                    </div>
                  ))}
                  {devices.every(d => d.online && (d.battery ?? 100) > 20) && (
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
                <h4 className="font-bold text-sm flex items-center gap-2"><Activity className="h-4 w-4 text-primary" /> Último Acceso</h4>
                {pins.filter(p => p.status === "active").slice(0, 4).map(p => (
                  <div key={p.id} className="flex items-center justify-between text-xs">
                    <div>
                      <p className="font-bold text-slate-800">{p.guestName}</p>
                      <p className="text-muted-foreground">{p.deviceName}</p>
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
              <p className="text-sm text-muted-foreground">{activePins} activos · Auto-generados desde iCal y reservas directas</p>
            </div>
            <div className="flex gap-2">
              {/* Auto-generate from direct bookings with phone */}
              {directBookings.filter(b => b.guestPhone && !pins.find(p => p.bookingRef === b.id)).length > 0 && (
                <Button variant="outline" className="gap-2 text-xs rounded-xl" onClick={() => {
                  directBookings.filter(b => b.guestPhone && !pins.find(p => p.bookingRef === b.id)).forEach(generatePinFromDirectBooking);
                }}>
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  Auto-generar de reservas directas
                </Button>
              )}
              <Button className="gradient-gold text-primary-foreground gap-2 rounded-xl text-xs" onClick={() => setShowPinForm(true)}>
                <Plus className="h-3.5 w-3.5" /> Crear PIN manual
              </Button>
            </div>
          </div>

          {/* Create PIN form */}
          {showPinForm && (
            <Card className="rounded-2xl border-primary/20 bg-primary/5 shadow-sm">
              <CardContent className="p-5 space-y-4">
                <h4 className="font-bold flex items-center gap-2 text-sm"><Key className="h-4 w-4 text-primary" /> Nuevo PIN de Acceso</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-black uppercase tracking-wider text-slate-500">Cerradura</Label>
                    <Select value={pinForm.deviceId} onValueChange={v => setPinForm(f => ({ ...f, deviceId: v }))}>
                      <SelectTrigger className="rounded-xl"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                      <SelectContent>
                        {lockDevices.map(d => <SelectItem key={d.id} value={d.id}>{d.name} · {d.propertyName}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-black uppercase tracking-wider text-slate-500">Nombre Huésped</Label>
                    <Input placeholder="Ana García" value={pinForm.guestName} onChange={e => setPinForm(f => ({ ...f, guestName: e.target.value }))} className="rounded-xl" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-black uppercase tracking-wider text-slate-500">PIN (4-8 dígitos)</Label>
                    <Input placeholder="5678" maxLength={8} value={pinForm.pin} onChange={e => setPinForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, "") }))} className="rounded-xl font-mono font-bold text-lg tracking-widest" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-black uppercase tracking-wider text-slate-500">Válido desde</Label>
                    <Input type="datetime-local" value={pinForm.validFrom} onChange={e => setPinForm(f => ({ ...f, validFrom: e.target.value }))} className="rounded-xl" title="Fecha y hora de inicio" aria-label="Válido desde" />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs font-black uppercase tracking-wider text-slate-500">Válido hasta</Label>
                    <Input type="datetime-local" value={pinForm.validTo} onChange={e => setPinForm(f => ({ ...f, validTo: e.target.value }))} className="rounded-xl" title="Fecha y hora de fin" aria-label="Válido hasta" />
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowPinForm(false)}>Cancelar</Button>
                  <Button className="flex-1 gradient-gold text-primary-foreground rounded-xl border-none" onClick={handleCreatePin} disabled={pinCreating || !pinForm.deviceId || !pinForm.pin || pinForm.pin.length < 4}>
                    {pinCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Crear PIN"}
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
            {pins.map(pin => {
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
                    {/* PIN display */}
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
                      </div>
                      <p className="text-[11px] text-muted-foreground font-medium">{pin.deviceName} · {pin.propertyName}</p>
                      <div className="flex items-center gap-3 text-[10px] text-slate-500 flex-wrap">
                        <span className="flex items-center gap-0.5"><Calendar className="h-3 w-3" /> Desde: {formatDateTime(pin.validFrom)}</span>
                        <span className="flex items-center gap-0.5"><Calendar className="h-3 w-3" /> Hasta: {formatDateTime(pin.validTo)}</span>
                        {pin.guestPhone && <span className="flex items-center gap-0.5"><Phone className="h-3 w-3" /> {pin.guestPhone}</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={() => navigator.clipboard.writeText(pin.pin)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-primary transition-colors" title="Copiar PIN">
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      {!inactive && (
                        <button type="button" onClick={() => {
                          setEditingPinId(pin.id);
                          setPinForm({
                            deviceId: pin.deviceId,
                            guestName: pin.guestName,
                            pin: pin.pin,
                            validFrom: pin.validFrom,
                            validTo: pin.validTo,
                            source: pin.source
                          });
                          setShowPinForm(true);
                        }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-primary transition-colors" title="Editar PIN">
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {!inactive && (
                        <button type="button" onClick={() => handleRevokePin(pin)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors" title="Revocar PIN">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
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
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold">Feeds iCal por Propiedad</h3>
                <p className="text-sm text-muted-foreground">Airbnb y VRBO incluyen los últimos 4 dígitos del teléfono → se usan como PIN automático</p>
              </div>
              <Button className="gradient-gold text-primary-foreground gap-2 rounded-xl text-xs" onClick={() => setShowIcalForm(true)}>
                <Plus className="h-3.5 w-3.5" /> Agregar feed
              </Button>
            </div>

            {/* Add iCal form */}
            {showIcalForm && (
              <Card className="rounded-2xl border-primary/20 bg-primary/5">
                <CardContent className="p-5 space-y-4">
                  <h4 className="font-bold text-sm flex items-center gap-2"><Link2 className="h-4 w-4 text-primary" /> Nuevo Feed iCal</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-black uppercase tracking-wider text-slate-500">Propiedad</Label>
                      <Select value={icalForm.propertyId} onValueChange={v => {
                        const prop = properties.find(p => p.id === v);
                        setIcalForm(f => ({ ...f, propertyId: v, propertyName: prop?.name ?? "" }));
                      }}>
                        <SelectTrigger className="rounded-xl"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                        <SelectContent>
                          {properties.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                          {properties.length === 0 && <SelectItem value="custom">Personalizada</SelectItem>}
                        </SelectContent>
                      </Select>

                      {/* Property Channel Shortcuts */}
                      {icalForm.propertyId && properties.find(p => p.id === icalForm.propertyId)?.channels?.filter(c => c.icalUrl).length! > 0 && (
                        <div className="mt-2 space-y-2">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Vínculos detectados en la propiedad:</p>
                          <div className="flex flex-wrap gap-2">
                            {properties.find(p => p.id === icalForm.propertyId)?.channels?.filter(c => c.icalUrl).map(ch => (
                              <Button 
                                key={ch.name} 
                                size="sm" 
                                variant="outline" 
                                title="Usar iCal de la propiedad"
                                className="h-6 text-[10px] rounded-lg gap-1 border-primary/20 bg-white"
                                onClick={() => setIcalForm(f => ({ 
                                  ...f, 
                                  url: ch.icalUrl || "", 
                                  channel: (ch.name.toLowerCase().includes("airbnb") ? "airbnb" : ch.name.toLowerCase().includes("vrbo") ? "vrbo" : "other") as any 
                                }))}
                              >
                                <Zap className="h-2.5 w-2.5 text-amber-500 fill-amber-500" />
                                Usar {ch.name}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-black uppercase tracking-wider text-slate-500">Canal</Label>
                      <Select value={icalForm.channel} onValueChange={v => setIcalForm(f => ({ ...f, channel: v as ICalConfig["channel"] }))}>
                        <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="airbnb">Airbnb</SelectItem>
                          <SelectItem value="vrbo">VRBO</SelectItem>
                          <SelectItem value="booking">Booking.com</SelectItem>
                          <SelectItem value="other">Otro</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5 col-span-2">
                      <Label className="text-xs font-black uppercase tracking-wider text-slate-500">URL del Feed iCal</Label>
                      <Input placeholder="https://www.airbnb.com/calendar/ical/XXXXX.ics?c=..." value={icalForm.url} onChange={e => setIcalForm(f => ({ ...f, url: e.target.value }))} className="rounded-xl font-mono text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-black uppercase tracking-wider text-slate-500">Cerradura destino (auto-PIN)</Label>
                      <Select value={icalForm.targetDeviceId} onValueChange={v => setIcalForm(f => ({ ...f, targetDeviceId: v }))}>
                        <SelectTrigger className="rounded-xl"><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                        <SelectContent>
                          {lockDevices.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-3 pt-5">
                      <button type="button" onClick={() => setIcalForm(f => ({ ...f, autoGeneratePins: !f.autoGeneratePins }))} aria-label="Alternar auto-generación de PINs">
                        {icalForm.autoGeneratePins
                          ? <ToggleRight className="h-7 w-7 text-primary" />
                          : <ToggleLeft className="h-7 w-7 text-slate-400" />}
                      </button>
                      <p className="text-xs font-bold text-slate-700">Auto-generar PINs al sincronizar</p>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowIcalForm(false)}>Cancelar</Button>
                    <Button className="flex-1 gradient-gold text-primary-foreground rounded-xl border-none" onClick={handleAddIcal} disabled={!icalForm.url}>Agregar Feed</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* iCal config cards */}
            {icalConfigs.length === 0 && !showIcalForm && (
              <Card className="border-dashed rounded-2xl">
                <CardContent className="py-16 text-center text-muted-foreground space-y-3">
                  <Calendar className="h-12 w-12 mx-auto opacity-20" />
                  <p className="font-bold">Sin feeds iCal configurados.</p>
                  <p className="text-sm max-w-sm mx-auto">Agrega la URL del iCal de Airbnb o VRBO para que los PINs se generen automáticamente con los últimos 4 dígitos del teléfono del huésped.</p>
                  <Button size="sm" className="gradient-gold text-primary-foreground rounded-xl border-none mx-auto" onClick={() => setShowIcalForm(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Agregar primer feed
                  </Button>
                </CardContent>
              </Card>
            )}

            {icalConfigs.map(config => (
              <Card key={config.id} className="rounded-2xl border-gray-100 shadow-sm overflow-hidden">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center text-white text-[10px] font-black shrink-0", CHANNEL_COLORS[config.channel] ?? "bg-slate-400")}>
                        {config.channel.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <h4 className="font-bold text-sm">{CHANNEL_LABELS[config.channel]} · {config.propertyName}</h4>
                        <p className="text-[10px] text-muted-foreground font-mono truncate max-w-[260px]">{config.url}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {config.autoGeneratePins && (
                        <Badge className="text-[9px] bg-primary/10 text-primary border-primary/20 border">
                          <Zap className="h-2.5 w-2.5 mr-0.5" /> Auto-PIN
                        </Badge>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-xl text-xs gap-1.5 h-8"
                        onClick={() => syncIcal(config)}
                        disabled={syncingIcalId === config.id}
                      >
                        <RefreshCw className={cn("h-3 w-3", syncingIcalId === config.id && "animate-spin")} />
                        {syncingIcalId === config.id ? "Sincronizando..." : "Sincronizar"}
                      </Button>
                    </div>
                  </div>

                  {config.lastSync && (
                    <p className="text-[10px] text-muted-foreground mb-3">
                      Última sync: {formatDateTime(config.lastSync)} · {config.bookings?.length ?? 0} reservas encontradas
                    </p>
                  )}

                  {/* Parsed bookings preview */}
                  {config.bookings && config.bookings.length > 0 && (
                    <div className="space-y-2 mt-3 border-t pt-3">
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Próximas reservas</p>
                      {config.bookings.slice(0, 4).map(booking => {
                        const pinExists = pins.find(p => p.bookingRef === booking.uid);
                        return (
                          <div key={booking.uid} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-slate-800 truncate">{booking.guestName}</p>
                              <p className="text-[10px] text-muted-foreground">{formatDate(booking.checkin)} → {formatDate(booking.checkout)} · {booking.nights}n</p>
                            </div>
                            <div className="flex items-center gap-2 ml-3 shrink-0">
                              {booking.phoneLast4 ? (
                                <div className="flex items-center gap-1">
                                  <Phone className="h-3 w-3 text-slate-400" />
                                  <span className="font-mono font-black text-xs text-slate-700">••••{booking.phoneLast4}</span>
                                </div>
                              ) : (
                                <span className="text-[9px] text-amber-500 font-bold">Sin teléfono</span>
                              )}
                              {pinExists
                                ? <Badge className="text-[9px] bg-green-500 text-white border-none h-4"><CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />PIN</Badge>
                                : booking.phoneLast4
                                  ? <Badge variant="outline" className="text-[9px] h-4 text-amber-600 border-amber-300">Sin PIN</Badge>
                                  : null
                              }
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Sidebar: How it works */}
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
                    { step: "3", text: "Se crea un PIN en TTLock = esos 4 dígitos, válido desde check-in 2pm hasta check-out 12pm" },
                    { step: "4", text: "Reservas directas: usamos el teléfono que ingresaste en el checkout del Hub" },
                  ].map(s => (
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
                <p className="text-[11px] text-amber-700 leading-relaxed">VRBO puede no incluir el teléfono en su iCal según configuración del anuncio. En ese caso el PIN debe crearse manualmente o integrando el Webhook de VRBO.</p>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-gray-100 shadow-sm">
              <CardContent className="p-5 space-y-3">
                <h4 className="font-bold text-sm flex items-center gap-2"><BookOpen className="h-4 w-4 text-primary" /> Cómo obtener el iCal de Airbnb</h4>
                <ol className="text-[11px] text-slate-600 space-y-2 list-decimal list-inside leading-relaxed">
                  <li>Ve a <strong>Menú → Anuncios</strong></li>
                  <li>Selecciona tu propiedad</li>
                  <li>Entra a <strong>Disponibilidad → Sincronizar calendarios</strong></li>
                  <li>Copia la URL del <strong>Exportar calendario</strong></li>
                  <li>Pégala arriba como nuevo feed</li>
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
          {/* Cuentas TTLock + asignación de cerraduras a propiedades */}
          <TTLockAccountsSection />

          {/* Variables de entorno / servidor */}
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
                Las cuentas TTLock individuales (usuario/contraseña) se guardan por tenant
                en la tabla <code className="bg-zinc-800 px-1 rounded">ttlock_accounts</code> (arriba).
              </p>
            </CardContent>
          </Card>

          {/* Zona de peligro */}
          <div className="pt-6 border-t border-red-100">
            <h4 className="text-sm font-black text-red-600 uppercase tracking-widest mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Zona de Peligro
            </h4>
            <p className="text-xs text-slate-500 mb-4">
              Borra el caché local (PINs/iCals/dispositivos cacheados). No toca cuentas TTLock ni propiedades.
            </p>
            <Button
              variant="outline"
              className="rounded-xl font-bold border-slate-200 text-slate-500 hover:bg-slate-50 h-11 px-6"
              onClick={() => {
                if (confirm("¿Limpiar caché local de dispositivos, PINs e iCals?")) {
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

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* IMPORT WIZARD (MODAL) — extraído a smart-devices/ImportWizardDialog */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <ImportWizardDialog
        open={showImportWizard}
        onOpenChange={setShowImportWizard}
        integrations={integrations}
        setIntegrations={setIntegrations}
        properties={properties}
        onDevicesImported={(newDevices) => setDevices((prev) => [...prev, ...newDevices])}
      />
    </div>
  );
}
