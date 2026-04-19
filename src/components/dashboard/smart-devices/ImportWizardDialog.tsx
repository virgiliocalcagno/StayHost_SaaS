"use client";

/**
 * Import Wizard — modal de 5 pasos para vincular cuentas TTLock/Tuya
 * y mapear dispositivos a propiedades.
 *
 * Pasos:
 *   1. terms       — aviso de tarifa + contrato
 *   2. provider    — elegir TTLock o Tuya
 *   3. auth        — credenciales (TTLock) o QR (Tuya)
 *   4. discovery   — spinner mientras se listan dispositivos
 *   5. mapping     — asignar dispositivos descubiertos a propiedades
 *
 * Todo el estado interno del wizard vive aquí. El padre sólo controla
 * apertura/cierre y recibe los dispositivos importados.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Info, Lock, Zap, QrCode, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  DeviceProvider,
  DeviceType,
  Integrations,
  Property,
  SmartDevice,
} from "./types";

type WizardStep = "terms" | "provider" | "auth" | "discovery" | "mapping";

const STEPS: WizardStep[] = ["terms", "provider", "auth", "discovery", "mapping"];

interface DiscoveredDevice {
  id: string;
  name: string;
  type: string;
  remoteId: string;
  battery?: number;
}

interface ImportWizardDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  integrations: Integrations;
  setIntegrations: React.Dispatch<React.SetStateAction<Integrations>>;
  properties: Property[];
  /** Callback cuando el usuario finaliza el wizard con dispositivos mapeados. */
  onDevicesImported: (devices: SmartDevice[]) => void;
}

export default function ImportWizardDialog({
  open,
  onOpenChange,
  integrations,
  setIntegrations,
  properties,
  onDevicesImported,
}: ImportWizardDialogProps) {
  const [step, setStep] = useState<WizardStep>("terms");
  const [selectedProvider, setSelectedProvider] =
    useState<DeviceProvider | null>(null);
  const [discoveredDevices, setDiscoveredDevices] = useState<
    DiscoveredDevice[]
  >([]);
  const [tuyaQrData, setTuyaQrData] = useState<{
    authUrl: string;
    qrUrl: string;
  } | null>(null);
  const [customTuyaQr, setCustomTuyaQr] = useState("");
  const [showTechnical, setShowTechnical] = useState(false);
  const [loadingQr, setLoadingQr] = useState(false);
  const [deviceMappings, setDeviceMappings] = useState<Record<string, string>>(
    {}
  );
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");

  // Reset completo cuando el modal se cierra
  useEffect(() => {
    if (!open) {
      setStep("terms");
      setSelectedProvider(null);
      setDiscoveredDevices([]);
      setDeviceMappings({});
      setImportError("");
      setCustomTuyaQr("");
      setShowTechnical(false);
      setTuyaQrData(null);
    }
  }, [open]);

  // Fetch QR real de Tuya cuando el usuario entra al paso auth con Tuya
  useEffect(() => {
    if (!open || selectedProvider !== "tuya" || step !== "auth") return;
    let cancelled = false;
    (async () => {
      setLoadingQr(true);
      try {
        const res = await fetch("/api/tuya", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "getAuthData",
            credentials: {
              clientId: integrations.tuya.clientId,
              region: integrations.tuya.region,
            },
          }),
        });
        const data = await res.json();
        if (!cancelled && data.success) setTuyaQrData(data.result);
      } catch (err) {
        console.error("Error fetching Tuya QR:", err);
      } finally {
        if (!cancelled) setLoadingQr(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, selectedProvider, step, integrations.tuya.clientId, integrations.tuya.region]);

  const handleConnect = async () => {
    setImportError("");
    setImporting(true);
    try {
      if (selectedProvider === "ttlock") {
        const res = await fetch("/api/ttlock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "getToken",
            username: integrations.ttlock.username,
            password: integrations.ttlock.password,
          }),
        });
        const data = await res.json();
        if (data.errcode && data.errcode !== 0)
          throw new Error(data.errmsg || "Error de autenticación");
        if (data.error) throw new Error(data.error_description || data.error);

        const token = data.access_token;
        setIntegrations((prev) => ({
          ...prev,
          ttlock: { ...prev.ttlock, accessToken: token },
        }));

        setStep("discovery");

        const listRes = await fetch("/api/ttlock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "listLocks", accessToken: token }),
        });
        const listData = await listRes.json();
        const locks = listData.mock ? listData.data.list : listData.list;

        setDiscoveredDevices(
          (locks ?? []).map((l: { lockId: string; lockAlias?: string; lockName?: string; electricQuantity?: number }) => ({
            id: String(l.lockId),
            name: l.lockAlias || l.lockName || `Lock ${l.lockId}`,
            type: "lock_ttlock",
            remoteId: String(l.lockId),
            battery: l.electricQuantity,
          }))
        );
        setStep("mapping");
      } else {
        // TUYA
        setStep("discovery");
        const authRes = await fetch("/api/tuya", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "getToken",
            credentials: {
              clientId: integrations.tuya.clientId,
              clientSecret: integrations.tuya.clientSecret,
              region: integrations.tuya.region,
            },
          }),
        });
        const authData = await authRes.json();

        if (authData.mock) {
          setDiscoveredDevices(
            (authData.data ?? []).map((d: { id: string; name: string }) => ({
              id: d.id,
              name: d.name,
              type: "tuya_device",
              remoteId: d.id,
              battery: 100,
            }))
          );
        } else {
          if (!authData.success)
            throw new Error(authData.msg || "Error al conectar con Tuya");
          const token = authData.result.access_token;

          const listRes = await fetch("/api/tuya", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "listAllDevices",
              accessToken: token,
              credentials: {
                clientId: integrations.tuya.clientId,
                clientSecret: integrations.tuya.clientSecret,
                region: integrations.tuya.region,
              },
            }),
          });
          const listData = await listRes.json();
          if (!listData.success)
            throw new Error(listData.msg || "Error al listar dispositivos");

          const devices = listData.result.list || listData.result || [];
          setDiscoveredDevices(
            devices.map((d: { id: string; name: string }) => ({
              id: d.id,
              name: d.name,
              type: "tuya_device",
              remoteId: d.id,
              battery: 100,
            }))
          );
        }
        setStep("mapping");
      }
    } catch (err) {
      setImportError(String(err));
      console.error(err);
    } finally {
      setImporting(false);
    }
  };

  const handleFinish = () => {
    const toAdd: SmartDevice[] = discoveredDevices
      .filter(
        (d) => deviceMappings[d.remoteId] && deviceMappings[d.remoteId] !== "none"
      )
      .map((d) => {
        const propId = deviceMappings[d.remoteId];
        const propName =
          properties.find((p) => p.id === propId)?.name || "Propiedad Principal";
        return {
          id: `dev-${Date.now()}-${d.remoteId}`,
          remoteId: d.remoteId,
          name: d.name,
          type: d.type as DeviceType,
          provider: selectedProvider!,
          propertyId: propId,
          propertyName: propName,
          online: true,
          battery: d.battery ?? 100,
          lastSync: new Date().toISOString(),
        };
      });

    if (toAdd.length > 0) onDevicesImported(toAdd);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden border-none rounded-2xl shadow-2xl">
        {/* Header + progress */}
        <DialogHeader className="bg-zinc-950 p-6 text-white space-y-0">
          <div className="flex items-center justify-between mb-4">
            <Badge className="bg-amber-500 hover:bg-amber-600 text-white border-none font-bold">
              Conectar Dispositivos
            </Badge>
            <div className="flex gap-1">
              {STEPS.map((s, idx) => (
                <div
                  key={s}
                  className={cn(
                    "h-1.5 w-8 rounded-full transition-all",
                    step === s
                      ? "bg-amber-500 w-12"
                      : idx < STEPS.indexOf(step)
                      ? "bg-amber-500/50"
                      : "bg-zinc-800"
                  )}
                />
              ))}
            </div>
          </div>
          <DialogTitle className="text-xl font-black tracking-tight">
            {step === "terms" && "Términos y Suscripción"}
            {step === "provider" && "Seleccionar Marca"}
            {step === "auth" &&
              `Conectar con ${selectedProvider === "ttlock" ? "TTLock" : "Tuya"}`}
            {step === "discovery" && "Buscando Dispositivos..."}
            {step === "mapping" && "Vincular a Propiedades"}
          </DialogTitle>
          <DialogDescription className="text-zinc-400 mt-1">
            Configura tu integración StayHost paso a paso.
          </DialogDescription>
        </DialogHeader>

        <div className="p-6 bg-white">
          {/* Step 1: terms */}
          {step === "terms" && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl flex gap-3">
                <Info className="h-5 w-5 text-amber-600 shrink-0" />
                <div className="text-xs text-amber-900 leading-relaxed">
                  <p className="font-bold mb-1">
                    Aviso de Tarifa StayHost Intelligence
                  </p>
                  StayHost cobra una tarifa de mantenimiento de{" "}
                  <b>$5.00 USD mensuales</b> por cada dispositivo conectado para
                  garantizar la sincronización 24/7 con canales (Airbnb, etc.) y
                  la generación automática de PINs.
                </div>
              </div>
              <div className="space-y-3 bg-slate-50 p-4 rounded-xl text-[11px] text-slate-600 max-h-[200px] overflow-y-auto">
                <p className="font-bold text-slate-900">
                  Contrato de Servicio de Automatización
                </p>
                <p>
                  1. Estás vinculando tus cuentas de terceros a StayHost
                  Intelligence.
                </p>
                <p>
                  2. StayHost gestionará la creación y eliminación de códigos
                  temporales basados en tus reservas de iCal.
                </p>
                <p>
                  3. Los datos de acceso se encriptan con estándares bancarios.
                </p>
                <p>
                  4. Al continuar, aceptas el cargo recurrente de $5 por
                  dispositivo.
                </p>
              </div>
              <Button
                className="w-full gradient-gold text-primary-foreground font-bold h-11"
                onClick={() => setStep("provider")}
              >
                Acepto los términos y continuar
              </Button>
            </div>
          )}

          {/* Step 2: provider */}
          {step === "provider" && (
            <div className="grid grid-cols-2 gap-4 pb-4">
              <button
                type="button"
                onClick={() => {
                  setSelectedProvider("ttlock");
                  setStep("auth");
                }}
                className="flex flex-col items-center justify-center p-6 border-2 border-slate-100 rounded-2xl hover:border-amber-400 hover:bg-amber-50/30 transition-all group"
              >
                <div className="p-3 bg-blue-50 rounded-xl mb-3 group-hover:scale-110 transition-transform">
                  <Lock className="h-8 w-8 text-blue-600" />
                </div>
                <span className="font-black text-sm">TTLock</span>
                <span className="text-[10px] text-muted-foreground mt-1">
                  Global Locks
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedProvider("tuya");
                  setStep("auth");
                }}
                className="flex flex-col items-center justify-center p-6 border-2 border-slate-100 rounded-2xl hover:border-orange-400 hover:bg-orange-50/30 transition-all group"
              >
                <div className="p-3 bg-orange-50 rounded-xl mb-3 group-hover:scale-110 transition-transform">
                  <Zap className="h-8 w-8 text-orange-600" />
                </div>
                <span className="font-black text-sm">Tuya Smart</span>
                <span className="text-[10px] text-muted-foreground mt-1">
                  SmartLife Ecosystem
                </span>
              </button>
            </div>
          )}

          {/* Step 3: auth */}
          {step === "auth" && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground text-center">
                Introduce las credenciales que usas en la App{" "}
                {selectedProvider === "ttlock" ? "TTLock" : "SmartLife"}
              </p>
              {selectedProvider === "ttlock" ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">Email / Usuario</Label>
                    <Input
                      placeholder="+1 809 000 0000"
                      className="rounded-xl h-11"
                      value={integrations.ttlock.username}
                      onChange={(e) =>
                        setIntegrations((prev) => ({
                          ...prev,
                          ttlock: { ...prev.ttlock, username: e.target.value },
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold">Contraseña</Label>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      className="rounded-xl h-11"
                      value={integrations.ttlock.password}
                      onChange={(e) =>
                        setIntegrations((prev) => ({
                          ...prev,
                          ttlock: { ...prev.ttlock, password: e.target.value },
                        }))
                      }
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="flex flex-col items-center gap-4 py-4 px-6 bg-orange-50/50 border border-orange-100 rounded-3xl">
                    <div className="p-4 bg-white rounded-2xl shadow-sm border border-orange-100 ring-4 ring-orange-50 min-h-[140px] flex items-center justify-center">
                      {loadingQr ? (
                        <Loader2 className="h-8 w-8 animate-spin text-orange-200" />
                      ) : tuyaQrData?.qrUrl || customTuyaQr ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={
                            customTuyaQr
                              ? `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(
                                  customTuyaQr
                                )}&size=300x300`
                              : tuyaQrData?.qrUrl
                          }
                          alt="Tuya Auth QR"
                          className="h-32 w-32 object-contain"
                        />
                      ) : (
                        <QrCode className="h-16 w-16 text-orange-200" />
                      )}
                    </div>
                    <div className="text-center space-y-1">
                      <p className="text-sm font-bold text-orange-900 uppercase tracking-tight">
                        Sincronización REAL por QR
                      </p>
                      <p className="text-[11px] text-orange-700 leading-relaxed max-w-[200px] mx-auto">
                        Escanea este código con tu App{" "}
                        <b>SmartLife/Tuya</b> para autorizar el acceso y pulsa
                        el botón de abajo.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setShowTechnical(!showTechnical)}
                    className="text-[10px] text-orange-600 font-bold uppercase tracking-wider flex items-center gap-1 mx-auto hover:underline"
                  >
                    {showTechnical
                      ? "Ocultar Ajustes"
                      : "Ajustes Técnicos (Opcional)"}
                  </button>

                  {showTechnical && (
                    <div className="space-y-3 p-4 bg-zinc-50 rounded-2xl border border-zinc-100 animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="space-y-1.5">
                        <Label className="text-[10px] font-bold text-zinc-500 uppercase">
                          Manual QR Link / Token
                        </Label>
                        <Input
                          placeholder="tuyaSmart--qrLogin?token=..."
                          className="text-[11px] rounded-xl h-9"
                          value={customTuyaQr}
                          onChange={(e) => setCustomTuyaQr(e.target.value)}
                        />
                        <p className="text-[10px] text-zinc-400 italic">
                          Pega aquí el enlace de tu consola si el QR automático
                          falla.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 px-3 py-2 bg-zinc-100 rounded-full">
                    <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse ml-1" />
                    <span className="text-[10px] font-medium text-zinc-500">
                      Servidores de Tuya Cloud listos para vincular
                    </span>
                  </div>
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1 rounded-xl"
                  onClick={() => setStep("provider")}
                >
                  Atrás
                </Button>
                <Button
                  className="flex-[2] gradient-gold text-primary-foreground font-bold rounded-xl"
                  disabled={importing}
                  onClick={handleConnect}
                >
                  {importing ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  {selectedProvider === "tuya"
                    ? "Sincronizar Dispositivos"
                    : "Conectar Cuenta"}
                </Button>
              </div>
              {importError && (
                <p className="text-[10px] text-red-500 mt-2 text-center bg-red-50 p-2 rounded-lg border border-red-100">
                  {importError}
                </p>
              )}
            </div>
          )}

          {/* Step 4: discovery */}
          {step === "discovery" && (
            <div className="py-12 flex flex-col items-center gap-4">
              <div className="relative">
                <div className="absolute inset-0 bg-amber-400/20 blur-xl rounded-full scale-150 animate-pulse" />
                <Loader2 className="h-12 w-12 text-amber-500 animate-spin relative z-10" />
              </div>
              <div className="text-center">
                <p className="font-bold text-lg">Buscando dispositivos...</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Sincronizando con los servidores de{" "}
                  {selectedProvider === "ttlock" ? "TTLock" : "Tuya"}
                </p>
              </div>
            </div>
          )}

          {/* Step 5: mapping */}
          {step === "mapping" && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Hemos encontrado {discoveredDevices.length} dispositivos.
                Asígnalos a tus propiedades para finalizar.
              </p>
              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                {discoveredDevices.map((dev) => (
                  <div
                    key={dev.id}
                    className="p-3 border rounded-xl flex items-center justify-between gap-4 hover:border-amber-200 hover:bg-amber-50/20 transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-slate-100 rounded-lg">
                        {dev.type.includes("tuya") ? (
                          <Zap className="h-4 w-4 text-orange-600" />
                        ) : (
                          <Lock className="h-4 w-4 text-blue-600" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-bold">{dev.name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono uppercase">
                          {dev.remoteId}
                        </p>
                      </div>
                    </div>
                    <Select
                      value={deviceMappings[dev.remoteId] || "none"}
                      onValueChange={(val) =>
                        setDeviceMappings((prev) => ({
                          ...prev,
                          [dev.remoteId]: val,
                        }))
                      }
                    >
                      <SelectTrigger className="w-[150px] h-8 text-xs rounded-lg">
                        <SelectValue placeholder="Propiedad..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Omitir</SelectItem>
                        {properties.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                        {properties.length === 0 && (
                          <SelectItem value="custom-1">
                            Propiedad Principal
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <Button
                className="w-full h-11 gradient-gold text-primary-foreground font-extrabold text-sm uppercase tracking-wider shadow-lg rounded-xl"
                onClick={handleFinish}
              >
                Finalizar e Importar{" "}
                {
                  Object.values(deviceMappings).filter((v) => v !== "none")
                    .length
                }{" "}
                Dispositivos
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
