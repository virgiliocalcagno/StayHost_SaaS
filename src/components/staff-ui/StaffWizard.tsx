"use client";

import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  ArrowRight,
  Sparkles,
  Clock,
  ClipboardList,
  Check,
  Tv,
  Archive,
  Wind,
  Box,
  Camera,
  Image as ImageIcon,
  AlertTriangle,
  Plus,
  Trash2,
  Wrench,
  Loader2,
  RotateCw,
  MessageCircle,
  KeyRound,
  Wifi,
  Copy,
  ChevronDown,
  ChevronUp,
  Lock,
} from "lucide-react";
import { CleaningTask, getPriorityInfo } from "@/types/staff";
import { capturePhoto } from "@/lib/photos/capturePhoto";
import { buildHelpWhatsappHref } from "@/lib/staff-help/buildHelpMessage";
import {
  MAINTENANCE_CATEGORY_LABELS,
  MAINTENANCE_SEVERITY_LABELS,
  type MaintenanceCategory,
  type MaintenanceSeverity,
} from "@/types/maintenance";

export interface IssueDraft {
  localId: string;
  title: string;
  category: MaintenanceCategory;
  severity: MaintenanceSeverity;
  description: string;
  photos: string[];
}

export interface StaffWizardProps {
  task: CleaningTask;
  activeCriteria: string[];
  ownerWhatsapp?: string | null;
  staffName?: string | null;
  onClose: () => void;
  onSubmit: (
    taskId: string,
    photos: { category: string; url: string }[],
    notes: string,
    issues: IssueDraft[]
  ) => void;
  onToggleChecklist?: (taskId: string, itemId: string) => void;
}

const SEVERITY_COLORS: Record<MaintenanceSeverity, string> = {
  low: "bg-slate-100 text-slate-700 border-slate-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  critical: "bg-rose-100 text-rose-800 border-rose-200",
};

export function StaffWizard({ task, activeCriteria, ownerWhatsapp, staffName, onClose, onSubmit, onToggleChecklist }: StaffWizardProps) {
  const helpHref = buildHelpWhatsappHref(ownerWhatsapp, {
    staffName,
    propertyName: task.propertyName,
    dueTime: task.dueTime,
  });
  const [wizardStep, setWizardStep] = useState(1);
  const [tempPhotos, setTempPhotos] = useState<{ category: string; url: string }[]>([]);
  const [uploadStatus, setUploadStatus] = useState<Record<string, "idle" | "uploading" | "done" | "error">>({});
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});

  // Pre-cargar fotos ya subidas. Si la cleaner se cortó la red, cerró el
  // wizard, o vuelve después, las fotos que ya subió aparecen marcadas como
  // "LISTO" en lugar de pedirle que las re-suba. Bug que reportó Virgilio:
  // cargaba la tarea, salía, volvía a entrar y le pedía las 3 fotos otra vez
  // aunque ya estaban en BD.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/cleaning-tasks/${encodeURIComponent(task.id)}/photos`, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : { photos: [] }))
      .then((data: { photos?: { category: string; url: string | null }[] }) => {
        if (cancelled) return;
        const seeded = (data.photos ?? [])
          .filter((p) => p.url)
          .map((p) => ({ category: p.category, url: p.url! }));
        if (seeded.length === 0) return;
        setTempPhotos(seeded);
        const statusSeed: Record<string, "done"> = {};
        for (const p of seeded) statusSeed[p.category] = "done";
        setUploadStatus(statusSeed);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [task.id]);
  const [activeUploadCategory, setActiveUploadCategory] = useState<string | null>(null);
  // Dos inputs separados: uno con capture="environment" abre cámara directa;
  // el otro sin capture muestra galería. Sin esta separación el browser
  // (especialmente Safari iOS y Chrome Android) muestra solo galería.
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const [notes, setNotes] = useState("");
  const [issues, setIssues] = useState<IssueDraft[]>([]);
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftCategory, setDraftCategory] = useState<MaintenanceCategory>("other");
  const [draftSeverity, setDraftSeverity] = useState<MaintenanceSeverity>("medium");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftPhotos, setDraftPhotos] = useState<string[]>([]);
  // Estado local para checklist (si no se pasa handler externo, maneja el estado internamente)
  const [localChecklist, setLocalChecklist] = useState(task.checklistItems || []);
  // Acceso a la unidad — visible durante todo el wizard. Bug que reportó
  // Virgilio: al iniciar la limpieza el cleaner perdía el PIN/wifi/keybox
  // y no podía consultarlo sin salir y perder el state. Default abierto
  // los primeros pasos (cuando entra), después la cleaner puede colapsar.
  const [accessOpen, setAccessOpen] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyToClipboard = (value: string, key: string) => {
    if (!value) return;
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
  };
  // Tarea ya validada por supervisor → modo solo-lectura. El cleaner no
  // debe poder modificar fotos, checklist ni reenviar. Si el supervisor
  // necesita cambios, debe reabrir la tarea desde el dashboard.
  const isValidated = !!task.validatedAt;

  const handleNextStep = () => setWizardStep(prev => Math.min(prev + 1, 3));
  const handlePrevStep = () => setWizardStep(prev => Math.max(prev - 1, 1));

  const handleToggleItem = (itemId: string) => {
    if (onToggleChecklist) {
      onToggleChecklist(task.id, itemId);
    } else {
      setLocalChecklist(prev => 
        prev.map(i => i.id === itemId ? { ...i, done: !i.done } : i)
      );
    }
  };

  const currentChecklist = onToggleChecklist ? (task.checklistItems || []) : localChecklist;

  const handleUploadPhoto = (category: string, source: "camera" | "gallery") => {
    setActiveUploadCategory(category);
    setUploadErrors(prev => ({ ...prev, [category]: "" }));
    const ref = source === "camera" ? cameraInputRef : galleryInputRef;
    ref.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const cat = activeUploadCategory;
    if (!file || !cat) return;

    setUploadStatus(prev => ({ ...prev, [cat]: "uploading" }));
    try {
      const { blob } = await capturePhoto(file, {
        watermarkLabel: task.propertyName,
      });
      const fd = new FormData();
      fd.append("file", new File([blob], `${cat}.jpg`, { type: "image/jpeg" }));
      fd.append("category", cat);

      const res = await fetch(`/api/cleaning-tasks/${task.id}/photos`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))).error || `Error ${res.status}`;
        throw new Error(msg);
      }
      const data: { category: string; path: string; url: string | null } = await res.json();

      setTempPhotos(prev => {
        const filtered = prev.filter(p => p.category !== cat);
        return [...filtered, { category: cat, url: data.url ?? "" }];
      });
      setUploadStatus(prev => ({ ...prev, [cat]: "done" }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      setUploadErrors(prev => ({ ...prev, [cat]: message }));
      setUploadStatus(prev => ({ ...prev, [cat]: "error" }));
    }
  };

  const handleSubmitTask = () => {
    // Tarea ya validada: no se puede reenviar. Esto NUNCA debería dispararse
    // porque el botón está disabled, pero protegemos por si llegara por
    // teclado/atajo.
    if (isValidated) return;
    // Nudge UX (no bloqueo): si el cleaner no marcó todos los items del
    // checklist, le advertimos antes de enviar. La realidad LATAM es que
    // a veces hace la limpieza completa pero olvida tildar — preferimos
    // recordarle a obligarla. Si confirma, sigue. Si no, vuelve al wizard
    // a marcarlos. Si no hay checklist (propiedad sin items configurados),
    // el chequeo no aplica.
    const total = currentChecklist.length;
    const done = currentChecklist.filter(i => i.done).length;
    if (total > 0 && done < total) {
      const ok = window.confirm(
        `Vas a enviar la limpieza con ${done} de ${total} tareas del checklist marcadas.\n\n¿Estás segura?`
      );
      if (!ok) return;
    }
    onSubmit(task.id, tempPhotos, notes, issues);
  };

  const resetIssueDraft = () => {
    setDraftTitle("");
    setDraftCategory("other");
    setDraftSeverity("medium");
    setDraftDescription("");
    setDraftPhotos([]);
  };

  const handleSaveIssue = () => {
    if (!draftTitle.trim()) return;
    setIssues(prev => [
      ...prev,
      {
        localId: `issue-${Date.now()}-${prev.length}`,
        title: draftTitle.trim(),
        category: draftCategory,
        severity: draftSeverity,
        description: draftDescription.trim(),
        photos: draftPhotos,
      },
    ]);
    resetIssueDraft();
    setShowIssueForm(false);
  };

  const handleRemoveIssue = (localId: string) => {
    setIssues(prev => prev.filter(i => i.localId !== localId));
  };

  const handleAddIssuePhoto = () => {
    // Simula subida — la app real usaría el mismo pipeline que las fotos de cierre
    const mockUrl = "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=400&h=300&fit=crop";
    setDraftPhotos(prev => (prev.length >= 3 ? prev : [...prev, mockUrl]));
  };

  return (
    <div className="min-h-screen bg-[#F8F9FC] text-slate-900 pb-20 animate-in fade-in transition-all duration-500">
      {/* Standalone App Header */}
      <div className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b px-4 py-4 flex items-center justify-between shadow-sm">
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={onClose} 
          className="rounded-full h-10 w-10 border border-slate-100 bg-white shadow-sm"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        
        <div className="text-center flex-1">
          <h3 className="font-bold text-slate-800 text-sm">Modulo Staff</h3>
          <div className="flex items-center justify-center gap-1 mt-1">
             {[1, 2, 3].map(s => (
               <div key={s} className={cn(
                 "h-1 rounded-full transition-all duration-300",
                 s === wizardStep ? "w-6 bg-primary" : "w-2 bg-slate-200"
               )} />
             ))}
          </div>
        </div>

        {helpHref ? (
          <a
            href={helpHref}
            target="_blank"
            rel="noopener noreferrer"
            className="h-10 px-3 flex items-center justify-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full shadow-md active:scale-95 transition-all"
            aria-label="Pedir ayuda al supervisor"
          >
            <MessageCircle className="h-4 w-4" />
            <span className="text-xs font-bold">Ayuda</span>
          </a>
        ) : (
          <div className="h-10 w-10 flex items-center justify-center bg-primary/10 rounded-full">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
        )}
      </div>

      <div className="max-w-md mx-auto px-4 pt-6 space-y-6">
        {/* Property Summary Card */}
        <Card className="border-none shadow-xl shadow-slate-200/50 rounded-[2rem] overflow-hidden bg-white">
          <div className="h-40 relative">
            <img src={task.propertyImage || "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=300"} className="w-full h-full object-cover" alt="Property" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex items-end p-6">
              <div>
                <Badge className={cn(
                  "mb-2 border-none",
                  getPriorityInfo(task).color,
                  getPriorityInfo(task).isUrgent && "animate-pulse"
                )}>
                  {getPriorityInfo(task).label}
                </Badge>
                <h4 className="text-white font-bold text-lg leading-tight">{task.address}</h4>
                <p className="text-white/70 text-xs flex items-center gap-1 mt-1">
                   <Clock className="h-3 w-3" /> Salida hoy: {task.dueTime}
                </p>
              </div>
            </div>
          </div>
          <div className="flex divide-x border-t">
             <div className="flex-1 p-4 text-center">
                <p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider mb-1">Huésped</p>
                <p className="font-bold text-slate-700">{task.guestName}</p>
             </div>
             <div className="flex-1 p-4 text-center">
                <p className="text-[10px] uppercase text-slate-400 font-bold tracking-wider mb-1">Duración</p>
                <p className="font-bold text-slate-700">{task.stayDuration || 1} NOCHES</p>
             </div>
          </div>
        </Card>

        {/* Tarea validada — banner de solo lectura. */}
        {isValidated && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-start gap-3">
            <Lock className="h-5 w-5 text-emerald-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-bold text-emerald-800 text-sm">Tarea validada — solo lectura</p>
              <p className="text-emerald-700 text-xs mt-1">
                El supervisor ya aprobó esta limpieza. Si necesitás corregir algo, pedile que la reabra.
              </p>
            </div>
          </div>
        )}

        {/* Acceso a la unidad — siempre visible durante el wizard. */}
        {(task.accessMethod || task.wifiName || task.wifiPassword || task.keyboxCode || task.accessPin) && (
          <Card className="border border-slate-200 rounded-[2rem] p-4 bg-white shadow-soft">
            <button
              onClick={() => setAccessOpen((o) => !o)}
              className="w-full flex items-center justify-between"
            >
              <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" /> Acceso a la unidad
              </h4>
              {accessOpen ? (
                <ChevronUp className="h-4 w-4 text-slate-400" />
              ) : (
                <ChevronDown className="h-4 w-4 text-slate-400" />
              )}
            </button>
            {accessOpen && (
              <div className="mt-3 space-y-2">
                {task.accessMethod === "ttlock" && task.accessPin && (
                  <button
                    onClick={() => copyToClipboard(task.accessPin!, "pin")}
                    className="w-full flex items-center justify-between bg-primary/5 border border-primary/20 rounded-xl p-3 active:scale-[0.98] transition-transform"
                  >
                    <div className="text-left">
                      <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">PIN puerta</p>
                      <p className="font-mono font-bold text-lg tracking-widest text-slate-800">{task.accessPin}</p>
                    </div>
                    <span className="text-[10px] text-slate-500 flex items-center gap-1">
                      {copiedKey === "pin" ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                      {copiedKey === "pin" ? "Copiado" : "Tocar para copiar"}
                    </span>
                  </button>
                )}
                {task.accessMethod === "keybox" && task.keyboxCode && (
                  <button
                    onClick={() => copyToClipboard(task.keyboxCode!, "keybox")}
                    className="w-full flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl p-3 active:scale-[0.98] transition-transform"
                  >
                    <div className="text-left">
                      <p className="text-[10px] uppercase text-amber-700 font-bold tracking-wider">Caja de llave</p>
                      <p className="font-mono font-bold text-lg tracking-widest text-slate-800">{task.keyboxCode}</p>
                      {task.keyboxLocation && (
                        <p className="text-[11px] text-amber-700 mt-1">📍 {task.keyboxLocation}</p>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-500 flex items-center gap-1">
                      {copiedKey === "keybox" ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                      {copiedKey === "keybox" ? "Copiado" : "Copiar"}
                    </span>
                  </button>
                )}
                {task.accessMethod === "in_person" && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600">
                    Esperá contacto del huésped o dueño para entrar.
                  </div>
                )}
                {task.wifiName && (
                  <button
                    onClick={() => copyToClipboard(task.wifiName!, "wifi-name")}
                    className="w-full flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl p-3 active:scale-[0.98] transition-transform"
                  >
                    <div className="text-left flex items-center gap-2">
                      <Wifi className="h-3.5 w-3.5 text-slate-500" />
                      <div>
                        <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Red WiFi</p>
                        <p className="font-mono text-sm font-semibold text-slate-800">{task.wifiName}</p>
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-500 flex items-center gap-1">
                      {copiedKey === "wifi-name" ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                    </span>
                  </button>
                )}
                {task.wifiPassword && (
                  <button
                    onClick={() => copyToClipboard(task.wifiPassword!, "wifi-pwd")}
                    className="w-full flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl p-3 active:scale-[0.98] transition-transform"
                  >
                    <div className="text-left flex items-center gap-2">
                      <Wifi className="h-3.5 w-3.5 text-slate-500" />
                      <div>
                        <p className="text-[10px] uppercase text-slate-500 font-bold tracking-wider">Contraseña WiFi</p>
                        <p className="font-mono text-sm font-semibold text-slate-800">{task.wifiPassword}</p>
                      </div>
                    </div>
                    <span className="text-[10px] text-slate-500 flex items-center gap-1">
                      {copiedKey === "wifi-pwd" ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                    </span>
                  </button>
                )}
              </div>
            )}
          </Card>
        )}

        {/* Wizard Step Content */}
        <div className={cn(
          "animate-in slide-in-from-right-4 duration-500",
          isValidated && "pointer-events-none opacity-60"
        )}>
          {wizardStep === 1 && (
            <div className="space-y-4">
              <div className="bg-white p-6 rounded-[2rem] shadow-soft border border-slate-100">
                <h4 className="text-base font-bold text-slate-800 flex items-center gap-2 mb-4">
                  <div className="h-8 w-8 rounded-xl bg-primary/10 flex items-center justify-center">
                    <ClipboardList className="h-4 w-4 text-primary" />
                  </div>
                  Checklist de Tareas
                </h4>
                <div className="space-y-4">
                  {currentChecklist.map((item) => (
                    <div 
                      key={item.id} 
                      onClick={() => handleToggleItem(item.id)}
                      className={cn(
                        "flex items-center gap-4 p-4 rounded-2xl border transition-all cursor-pointer",
                        item.done ? "bg-emerald-50/50 border-emerald-100" : "bg-slate-50 border-slate-100 hover:border-primary/30"
                      )}
                    >
                      <div className={cn(
                        "h-6 w-6 rounded-lg border-2 flex items-center justify-center transition-all",
                        item.done ? "bg-emerald-500 border-emerald-500 shadow-lg shadow-emerald-200" : "bg-white border-slate-200"
                      )}>
                        {item.done && <Check className="h-4 w-4 text-white" />}
                      </div>
                      <div className="flex-1">
                        <p className={cn("text-sm font-semibold transition-all", item.done ? "text-slate-500 line-through" : "text-slate-700")}>
                          {item.label}
                        </p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">{item.type === "appliance" ? "Equipo" : "Limpieza"}</p>
                      </div>
                      {item.type === "appliance" && <Tv className={cn("h-4 w-4", item.done ? "text-emerald-400" : "text-slate-300")} />}
                    </div>
                  ))}
                </div>
              </div>
              <Button className="w-full h-14 rounded-2xl gradient-gold text-primary-foreground font-bold shadow-xl shadow-primary/20" onClick={handleNextStep}>
                Siguiente paso <ArrowRight className="h-5 w-5 ml-2" />
              </Button>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-[2rem] shadow-soft border border-slate-100">
                <h4 className="text-base font-bold text-slate-800 flex items-center gap-2 mb-4">
                  <div className="h-8 w-8 rounded-xl bg-emerald-100 flex items-center justify-center">
                    <Box className="h-4 w-4 text-emerald-600" />
                  </div>
                  Suministros Requeridos
                </h4>
                <p className="text-xs text-slate-500 mb-6 font-medium">Prepara estos insumos según el tiempo de estancia:</p>
                
                <div className="grid grid-cols-1 gap-3">
                  {[
                    { name: "Papel Higiénico", qty: (task.stayDuration || 1) > 3 ? 4 : 2, icon: Archive },
                    { name: "Jabones de Baño", qty: (task.stayDuration || 1) > 3 ? 2 : 1, icon: Wind },
                    { name: "Toallas Limpias", qty: (task.stayDuration || 1) > 3 ? 6 : 4, icon: Tv },
                  ].map((item, idx) => (
                    <div key={idx} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                         <div className="h-10 w-10 bg-white rounded-xl flex items-center justify-center shadow-sm">
                            <item.icon className="h-5 w-5 text-slate-400" />
                         </div>
                         <span className="text-sm font-bold text-slate-700">{item.name}</span>
                      </div>
                      <div className="bg-emerald-500 text-white px-3 py-1 rounded-full text-xs font-bold">
                         x{item.qty}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white p-6 rounded-[2rem] shadow-soft border border-slate-100">
                 <Label className="text-sm font-bold text-slate-700 mb-3 block">Notas generales (opcional)</Label>
                 <textarea
                    placeholder="Comentarios sobre la limpieza, recordatorios, etc."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full h-24 p-4 rounded-2xl border border-slate-100 bg-slate-50 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                 />
                 <p className="text-[11px] text-slate-400 mt-2">
                   Los daños o problemas físicos se reportan como tickets abajo, no aquí.
                 </p>
              </div>

              {/* ── Reporte de problemas / tickets de mantenimiento ───────── */}
              <div className="bg-white p-6 rounded-[2rem] shadow-soft border border-slate-100">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <h4 className="text-base font-bold text-slate-800 flex items-center gap-2">
                      <div className="h-8 w-8 rounded-xl bg-rose-100 flex items-center justify-center">
                        <Wrench className="h-4 w-4 text-rose-600" />
                      </div>
                      Reportar problemas
                    </h4>
                    <p className="text-xs text-slate-500 mt-1">
                      Daños, faltantes o averías. No bloquea el cierre.
                    </p>
                  </div>
                  {issues.length > 0 && (
                    <Badge className="bg-rose-100 text-rose-700 border-none font-bold">
                      {issues.length}
                    </Badge>
                  )}
                </div>

                {issues.length > 0 && (
                  <div className="space-y-2 mb-4">
                    {issues.map((i) => (
                      <div
                        key={i.localId}
                        className="p-3 rounded-2xl border border-slate-100 bg-slate-50 flex items-start gap-3"
                      >
                        <div className="h-9 w-9 rounded-xl bg-white shadow-sm flex items-center justify-center flex-shrink-0">
                          <AlertTriangle className="h-4 w-4 text-rose-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-700 truncate">{i.title}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">
                              {MAINTENANCE_CATEGORY_LABELS[i.category]}
                            </span>
                            <span className={cn(
                              "text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wide",
                              SEVERITY_COLORS[i.severity]
                            )}>
                              {MAINTENANCE_SEVERITY_LABELS[i.severity]}
                            </span>
                            {i.photos.length > 0 && (
                              <span className="text-[10px] text-slate-400 font-semibold">
                                {i.photos.length} foto{i.photos.length > 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveIssue(i.localId)}
                          className="h-8 w-8 rounded-full text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {!showIssueForm ? (
                  <Button
                    variant="outline"
                    onClick={() => setShowIssueForm(true)}
                    className="w-full h-12 rounded-2xl border-dashed border-slate-300 text-slate-600 font-bold"
                  >
                    <Plus className="h-4 w-4 mr-2" /> Agregar reporte
                  </Button>
                ) : (
                  <div className="space-y-3 p-4 rounded-2xl border border-rose-100 bg-rose-50/40">
                    <div>
                      <Label className="text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1 block">
                        Título
                      </Label>
                      <input
                        type="text"
                        placeholder="Ej: Grifo de cocina gotea"
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1 block">
                          Categoría
                        </Label>
                        <select
                          value={draftCategory}
                          onChange={(e) => setDraftCategory(e.target.value as MaintenanceCategory)}
                          className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                        >
                          {(Object.keys(MAINTENANCE_CATEGORY_LABELS) as MaintenanceCategory[]).map((c) => (
                            <option key={c} value={c}>{MAINTENANCE_CATEGORY_LABELS[c]}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <Label className="text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1 block">
                          Severidad
                        </Label>
                        <select
                          value={draftSeverity}
                          onChange={(e) => setDraftSeverity(e.target.value as MaintenanceSeverity)}
                          className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                        >
                          {(Object.keys(MAINTENANCE_SEVERITY_LABELS) as MaintenanceSeverity[]).map((s) => (
                            <option key={s} value={s}>{MAINTENANCE_SEVERITY_LABELS[s]}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <Label className="text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1 block">
                        Descripción (opcional)
                      </Label>
                      <textarea
                        placeholder="Detalles, ubicación, etc."
                        value={draftDescription}
                        onChange={(e) => setDraftDescription(e.target.value)}
                        className="w-full h-16 p-3 rounded-xl border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-primary/20 outline-none"
                      />
                    </div>
                    <div>
                      <Label className="text-[11px] font-bold text-slate-600 uppercase tracking-wide mb-1 block">
                        Fotos ({draftPhotos.length}/3)
                      </Label>
                      <div className="flex gap-2 flex-wrap">
                        {draftPhotos.map((url, idx) => (
                          <img
                            key={idx}
                            src={url}
                            className="h-12 w-12 rounded-xl object-cover border-2 border-white shadow-sm"
                            alt={`Evidencia ${idx + 1}`}
                          />
                        ))}
                        {draftPhotos.length < 3 && (
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={handleAddIssuePhoto}
                            className="h-12 w-12 rounded-xl border-dashed"
                          >
                            <Camera className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button
                        variant="outline"
                        onClick={() => { resetIssueDraft(); setShowIssueForm(false); }}
                        className="flex-1 h-10 rounded-xl text-slate-600 font-bold"
                      >
                        Cancelar
                      </Button>
                      <Button
                        disabled={!draftTitle.trim()}
                        onClick={handleSaveIssue}
                        className="flex-1 h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold disabled:opacity-50"
                      >
                        Guardar reporte
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-4">
                <Button variant="outline" className="flex-1 h-14 rounded-2xl border-slate-200 text-slate-600 font-bold" onClick={handlePrevStep}>Anterior</Button>
                <Button className="flex-[2] h-14 rounded-2xl gradient-gold text-primary-foreground font-bold shadow-xl shadow-primary/20" onClick={handleNextStep}>Llegada a fotos</Button>
              </div>
            </div>
          )}

          {wizardStep === 3 && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-[2rem] shadow-soft border border-slate-100">
                 <h4 className="text-base font-bold text-slate-800 flex items-center gap-2 mb-6">
                    <div className="h-8 w-8 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Camera className="h-4 w-4 text-primary" />
                    </div>
                    Evidencia Final
                  </h4>
                  
                  <div className="space-y-4">
                    {activeCriteria.map((cat) => {
                      const photo = tempPhotos.find(p => p.category === cat);
                      const status = uploadStatus[cat] ?? "idle";
                      const error = uploadErrors[cat];
                      const isUploading = status === "uploading";
                      const isError = status === "error";
                      return (
                        <div key={cat} className="group relative">
                          <div className={cn(
                            "p-4 rounded-2xl border-2 border-dashed transition-all space-y-3",
                            isError
                              ? "bg-rose-50 border-rose-400"
                              : photo
                                ? "bg-emerald-50 border-emerald-500"
                                : "bg-slate-50 border-slate-200 hover:border-primary/50"
                          )}>
                            <div className="flex items-center gap-3 min-w-0">
                              {photo ? (
                                <img src={photo.url} className="h-12 w-12 rounded-xl object-cover shadow-md border-2 border-white" alt={`Evidencia ${cat}`}/>
                              ) : (
                                <div className="h-12 w-12 bg-white rounded-xl flex items-center justify-center shadow-sm">
                                  <ImageIcon className="h-5 w-5 text-slate-300" />
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="font-bold text-slate-700 text-sm">{cat}</p>
                                <p className="text-xs items-center flex gap-1 font-bold">
                                  {isUploading ? (
                                    <span className="text-slate-500 flex items-center gap-1">
                                      <Loader2 className="h-3 w-3 animate-spin" /> SUBIENDO…
                                    </span>
                                  ) : isError ? (
                                    <span className="text-rose-600 truncate">{error || "ERROR"}</span>
                                  ) : photo ? (
                                    <span className="text-emerald-600 flex items-center gap-1">
                                      <Check className="h-3 w-3" /> LISTO
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">OBLIGATORIO</span>
                                  )}
                                </p>
                              </div>
                              {photo && !isUploading && (
                                <div className="h-9 w-9 rounded-full bg-emerald-500 flex items-center justify-center shadow-md flex-shrink-0">
                                  <Check className="h-5 w-5 text-white" />
                                </div>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <Button
                                disabled={isUploading}
                                onClick={() => handleUploadPhoto(cat, "camera")}
                                className={cn(
                                  "flex-1 h-11 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shadow-md",
                                  isError
                                    ? "bg-rose-500 hover:bg-rose-600 text-white"
                                    : photo
                                      ? "bg-emerald-500/90 hover:bg-emerald-600 text-white"
                                      : "gradient-gold text-primary-foreground shadow-primary/20"
                                )}
                              >
                                {isUploading ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <>
                                    <Camera className="h-4 w-4" />
                                    {photo ? "Re-tomar" : "Cámara"}
                                  </>
                                )}
                              </Button>
                              <Button
                                disabled={isUploading}
                                variant="outline"
                                onClick={() => handleUploadPhoto(cat, "gallery")}
                                className="flex-1 h-11 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 border-slate-300 bg-white text-slate-700 shadow-sm"
                              >
                                <ImageIcon className="h-4 w-4" />
                                Galería
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                  />
              </div>

              <div className="bg-primary/5 p-4 rounded-2xl text-center border border-primary/10">
                 <p className="text-xs text-slate-500 font-medium">
                   Al finalizar, el reporte será enviado a revisión.<br />
                   <span className="font-bold text-primary">Insumos reportados correctamente ✅</span>
                 </p>
              </div>

              <div className="flex gap-4">
                 <Button variant="outline" className="flex-1 h-14 rounded-2xl border-slate-200 text-slate-600 font-bold" onClick={handlePrevStep}>Anterior</Button>
                 <Button
                    disabled={isValidated || tempPhotos.length < activeCriteria.length}
                    className="flex-[2] h-14 rounded-2xl bg-slate-900 hover:bg-black text-white font-bold shadow-xl shadow-black/20 disabled:opacity-50"
                    onClick={handleSubmitTask}
                 >
                   {isValidated ? "Validada" : "Enviar y Terminar"}
                 </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
