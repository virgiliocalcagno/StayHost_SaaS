"use client";

import React, { useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calendar,
  Clock,
  MapPin,
  User,
  Users,
  MessageSquare,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Camera,
  Bed,
  FileText,
  Wrench,
  PlayCircle,
  Send,
  ClipboardCheck,
  Hash,
  Sparkles,
  ListChecks,
  History,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getEffectiveStatus as deriveEffectiveStatus } from "@/lib/cleaning/status";
import { buildAccessMessageForStaff, shareAccessMessage, type AccessMethod } from "@/lib/access/share-message";

// ─── Types ──────────────────────────────────────────────────────────────────
// Importable shape — matches the CleaningTask shape used in CleaningPanel.

export interface CleaningTaskDetailData {
  id: string;
  propertyId: string;
  propertyName: string;
  address: string;
  propertyImage?: string;
  assigneeId?: string;
  assigneeName?: string;
  assigneeAvatar?: string;
  dueDate: string;
  dueTime: string;
  status: string;
  priority: string;
  isBackToBack: boolean;
  isVacant?: boolean;
  guestCount?: number;
  guestName: string;
  rejectionReason?: string;
  declinedByIds?: string[];
  standardInstructions?: string;
  startTime?: string;
  arrivingGuestName?: string;
  arrivingGuestCount?: number;
  isWaitingValidation?: boolean;
  closurePhotos?: { category: string; url: string }[];
  reportedIssues?: string[];
  checklistItems?: { id: string; label: string; done: boolean; type: "general" | "appliance" }[];
  bookingId?: string;
  bookingChannel?: string;
  bookingChannelCode?: string;
  bookingCheckIn?: string;
  bookingCheckOut?: string;
  guestPhone?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TeamMemberLite {
  id: string;
  name: string;
  avatar?: string;
  phone?: string;
}

export interface PropertyLite {
  id: string;
  name: string;
  bedConfiguration?: string;
  evidenceCriteria?: string[];
  address?: string;
  addressUnit?: string;
  neighborhood?: string;
  city?: string;
  accessMethod?: AccessMethod;
  keyboxCode?: string;
  keyboxLocation?: string;
  keyboxPhotoUrl?: string;
  keyboxShareWithGuest?: boolean;
  ttlockLockId?: string;
}

export interface CleaningTaskDetailModalProps {
  task: CleaningTaskDetailData | null;
  team: TeamMemberLite[];
  properties: PropertyLite[];
  onClose: () => void;
  onReassign: (taskId: string, memberId: string | null) => void;
  onValidate: (taskId: string) => void;
  onReopen: (taskId: string) => void;
  onMarkUrgent?: (taskId: string) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const CHANNEL_META: Record<string, { label: string; color: string }> = {
  airbnb: { label: "Airbnb", color: "bg-rose-500" },
  vrbo: { label: "VRBO", color: "bg-blue-500" },
  booking: { label: "Booking", color: "bg-blue-700" },
  manual: { label: "Directa", color: "bg-slate-500" },
  block: { label: "Bloqueo", color: "bg-amber-500" },
};

function getChannelMeta(channel?: string) {
  const key = (channel || "manual").toLowerCase();
  return CHANNEL_META[key] ?? CHANNEL_META.manual;
}

function getReservationCode(task: CleaningTaskDetailData): string {
  if (task.bookingChannelCode) return task.bookingChannelCode;
  if (task.bookingId) return `SH${task.bookingId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  // Fallback final: el id de tareas manuales suele venir como `task-<ts>`.
  // Stripeamos el prefijo legible para que el codigo final no diga "SHTASK".
  const cleanId = task.id.replace(/^(task-|booking-|block-)/, "").replace(/-/g, "");
  return "SH" + cleanId.slice(0, 8).toUpperCase();
}

function formatLongDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function formatTime12(time24?: string): string {
  if (!time24) return "";
  const [hStr, mStr] = time24.split(":");
  const h = parseInt(hStr, 10);
  const m = mStr ?? "00";
  if (isNaN(h)) return time24;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m} ${ampm}`;
}

function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("es", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function computeNights(checkIn?: string, checkOut?: string): number | null {
  if (!checkIn || !checkOut) return null;
  const a = new Date(checkIn);
  const b = new Date(checkOut);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  const diff = Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : null;
}

const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pendiente", cls: "bg-slate-100 text-slate-700 border-slate-200" },
  unassigned: { label: "Sin asignar", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  assigned: { label: "Asignada", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  accepted: { label: "Aceptada", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  rejected: { label: "Rechazada", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  in_progress: { label: "En progreso", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  completed: { label: "Completada", cls: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  issue: { label: "Con incidencia", cls: "bg-rose-100 text-rose-700 border-rose-200" },
};

function getStatusPill(status: string) {
  return STATUS_PILL[status] ?? STATUS_PILL.pending;
}

// Audit log derivado de los timestamps que ya tenemos. Sin migration nueva:
// `created_at`, `start_time`, `updated_at` + flags de status alcanzan para
// armar una linea de tiempo decente. P1 movera esto a `cleaning_task_events`.
type TimelineEvent = {
  label: string;
  detail?: string;
  timestamp?: string;
  icon: React.ComponentType<{ className?: string }>;
  done: boolean;
};

function buildTimeline(task: CleaningTaskDetailData): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  events.push({
    label: "Tarea creada",
    timestamp: task.createdAt,
    icon: Sparkles,
    done: true,
  });

  if (task.assigneeId && task.assigneeName) {
    events.push({
      label: "Asignada",
      detail: `a ${task.assigneeName}`,
      icon: User,
      done: true,
    });
  } else {
    events.push({
      label: "Sin asignar",
      detail: "Esperando asignacion",
      icon: User,
      done: false,
    });
  }

  if (task.status === "rejected" || (task.declinedByIds && task.declinedByIds.length > 0)) {
    events.push({
      label: "Rechazada por staff",
      detail: task.rejectionReason ?? undefined,
      icon: X,
      done: true,
    });
  }

  if (task.status === "accepted" || task.startTime || task.status === "in_progress" || task.status === "completed" || task.isWaitingValidation) {
    events.push({
      label: "Aceptada",
      icon: CheckCircle2,
      done: true,
    });
  }

  if (task.startTime || task.status === "in_progress" || task.isWaitingValidation || task.status === "completed") {
    events.push({
      label: "Limpieza iniciada",
      timestamp: task.startTime,
      icon: PlayCircle,
      done: true,
    });
  }

  if (task.isWaitingValidation || task.status === "completed") {
    events.push({
      label: "Reporte enviado",
      detail: "Esperando validacion del owner",
      timestamp: task.isWaitingValidation && !task.status?.includes("completed") ? task.updatedAt : undefined,
      icon: Send,
      done: true,
    });
  }

  if (task.status === "completed") {
    events.push({
      label: "Validada y cerrada",
      timestamp: task.updatedAt,
      icon: ClipboardCheck,
      done: true,
    });
  } else {
    events.push({
      label: "Validacion pendiente",
      icon: ClipboardCheck,
      done: false,
    });
  }

  return events;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CleaningTaskDetailModal({
  task,
  team,
  properties,
  onClose,
  onReassign,
  onValidate,
  onReopen,
  onMarkUrgent,
}: CleaningTaskDetailModalProps) {
  const property = useMemo(
    () => (task ? properties.find((p) => p.id === task.propertyId) : undefined),
    [task, properties],
  );

  const assignedMember = useMemo(
    () => (task?.assigneeId ? team.find((m) => m.id === task.assigneeId) : undefined),
    [task, team],
  );

  const handleShareAccessWithStaff = () => {
    if (!task || !property) return;
    const text = buildAccessMessageForStaff(
      {
        name: property.name,
        address: property.address ?? task.address,
        addressUnit: property.addressUnit,
        neighborhood: property.neighborhood,
        city: property.city,
        accessMethod: property.accessMethod,
        keyboxCode: property.keyboxCode,
        keyboxLocation: property.keyboxLocation,
        keyboxPhotoUrl: property.keyboxPhotoUrl,
        keyboxShareWithGuest: property.keyboxShareWithGuest,
        ttlockLockId: property.ttlockLockId,
      },
      {
        staffName: assignedMember?.name ?? task.assigneeName,
        taskDate: task.dueDate,
        taskTime: task.dueTime,
      },
    );
    void shareAccessMessage(text, assignedMember?.phone);
  };

  const checklistStats = useMemo(() => {
    if (!task?.checklistItems || task.checklistItems.length === 0) {
      return { done: 0, total: 0, pct: 0 };
    }
    const done = task.checklistItems.filter((i) => i.done).length;
    const total = task.checklistItems.length;
    return { done, total, pct: Math.round((done / total) * 100) };
  }, [task]);

  const timeline = useMemo(() => (task ? buildTimeline(task) : []), [task]);

  if (!task) return null;

  const channelMeta = getChannelMeta(task.bookingChannel);
  const statusPill = getStatusPill(deriveEffectiveStatus(task));
  const nights = computeNights(task.bookingCheckIn, task.bookingCheckOut ?? task.dueDate);
  const reservationCode = getReservationCode(task);

  const handleWhatsAppGuest = () => {
    if (!task.guestPhone) return;
    const phone = task.guestPhone.replace(/\D/g, "");
    const msg = encodeURIComponent(
      `Hola ${task.guestName}, te escribo de ${task.propertyName}. ¿Todo bien con tu estancia?`,
    );
    // noopener,noreferrer evita reverse tabnabbing — sin esto el dominio
    // de WhatsApp Web tendria acceso al window.opener del SaaS.
    window.open(`https://wa.me/${phone}?text=${msg}`, "_blank", "noopener,noreferrer");
  };

  const handleWhatsAppStaff = () => {
    const member = team.find((m) => m.id === task.assigneeId);
    if (!member?.phone) return;
    const phone = member.phone.replace(/\D/g, "");
    const link = `${typeof window !== "undefined" ? window.location.origin : ""}/staff?task=${task.id}`;
    const msg = encodeURIComponent(
      `Hola ${member.name}, tienes una limpieza en ${task.propertyName}. ✨\nAccede aqui: ${link}`,
    );
    window.open(`https://wa.me/${phone}?text=${msg}`, "_blank", "noopener,noreferrer");
  };

  return (
    <Sheet open={!!task} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl overflow-y-auto p-0"
      >
        {/* ─── Hero header con imagen de propiedad ───────────────────────── */}
        <div className="relative h-48 bg-slate-100">
          {task.propertyImage ? (
            <img
              src={task.propertyImage}
              alt={task.propertyName}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-primary/10 to-slate-200 flex items-center justify-center">
              <Sparkles className="h-12 w-12 text-primary/40" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
            <div className="flex items-center gap-2 mb-2">
              <Badge className={cn("border-0 text-[10px] font-black tracking-wider", channelMeta.color, "text-white")}>
                {channelMeta.label}
              </Badge>
              <span className="font-mono text-xs font-bold tracking-tight bg-white/20 backdrop-blur-sm px-2 py-0.5 rounded">
                {reservationCode}
              </span>
              {task.isBackToBack && (
                <Badge className="bg-rose-600 text-white border-0 text-[10px] font-black animate-pulse">
                  ⚡ BACK-TO-BACK
                </Badge>
              )}
            </div>
            <SheetHeader className="space-y-0.5">
              <SheetTitle className="text-white text-xl font-black leading-tight text-left">
                {task.propertyName}
              </SheetTitle>
              <p className="text-white/80 text-xs flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {task.address}
              </p>
            </SheetHeader>
          </div>
        </div>

        {/* ─── Pills row: status + priority + dueDate ────────────────────── */}
        <div className="px-6 py-4 border-b bg-slate-50/50 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn("font-bold border", statusPill.cls)}>
            {statusPill.label}
          </Badge>
          <Badge variant="outline" className="border-slate-200 text-slate-700 font-semibold">
            <Calendar className="h-3 w-3 mr-1" />
            Salida {formatLongDate(task.dueDate)} · {formatTime12(task.dueTime)}
          </Badge>
          {nights && (
            <Badge variant="outline" className="border-slate-200 text-slate-700">
              {nights} {nights === 1 ? "noche" : "noches"}
            </Badge>
          )}
        </div>

        {/* ─── Body sections ─────────────────────────────────────────────── */}
        <div className="px-6 py-6 space-y-6">

          {/* Reserva */}
          <Section icon={Hash} title="Reserva">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Huesped" value={task.guestName} />
              {task.guestCount ? <Field label="Pax salientes" value={String(task.guestCount)} /> : null}
              {task.bookingCheckIn ? (
                <Field
                  label="Estancia"
                  value={`${formatLongDate(task.bookingCheckIn)} → ${formatLongDate(task.bookingCheckOut ?? task.dueDate)}`}
                />
              ) : null}
              <Field label="Canal" value={`${channelMeta.label} · ${reservationCode}`} />
            </div>
            {task.guestPhone && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 h-9 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                onClick={handleWhatsAppGuest}
              >
                <MessageSquare className="h-4 w-4 mr-2" />
                WhatsApp al huesped
              </Button>
            )}
            {task.isBackToBack && task.arrivingGuestName && (
              <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-[10px] font-black text-rose-700 uppercase tracking-wider">
                    Entra hoy
                  </p>
                  <p className="text-sm font-bold text-rose-900">
                    {task.arrivingGuestName}
                    {task.arrivingGuestCount ? ` · ${task.arrivingGuestCount} pax` : ""}
                  </p>
                </div>
              </div>
            )}
          </Section>

          {/* Asignacion */}
          <Section icon={Users} title="Asignacion">
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12 border-2 border-white shadow-sm">
                <AvatarImage src={task.assigneeAvatar} />
                <AvatarFallback className="bg-slate-100">
                  {task.assigneeName?.charAt(0) || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <Select
                  value={task.assigneeId || "none"}
                  onValueChange={(v) => onReassign(task.id, v === "none" ? null : v)}
                >
                  <SelectTrigger className="h-9 font-bold">
                    <SelectValue placeholder="Sin asignar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin asignar</SelectItem>
                    {team.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {task.assigneeId && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 px-3 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                  onClick={handleWhatsAppStaff}
                >
                  <MessageSquare className="h-4 w-4" />
                </Button>
              )}
            </div>
            {task.rejectionReason && task.status === "rejected" && (
              <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200">
                <p className="text-[10px] font-black text-rose-700 uppercase tracking-wider mb-1">
                  Motivo de rechazo
                </p>
                <p className="text-sm text-rose-900">{task.rejectionReason}</p>
              </div>
            )}
          </Section>

          {/* Bed configuration */}
          {property?.bedConfiguration && (
            <Section icon={Bed} title="Configuracion de camas">
              <p className="text-sm text-slate-700">{property.bedConfiguration}</p>
            </Section>
          )}

          {/* Instrucciones */}
          {task.standardInstructions && (
            <Section icon={FileText} title="Instrucciones de limpieza">
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                {task.standardInstructions}
              </p>
            </Section>
          )}

          {/* Checklist */}
          <Section
            icon={ListChecks}
            title="Checklist"
            badge={`${checklistStats.done}/${checklistStats.total} · ${checklistStats.pct}%`}
          >
            {checklistStats.total > 0 ? (
              <>
                <Progress value={checklistStats.pct} className="h-2 mb-3" />
                <div className="space-y-1.5">
                  {task.checklistItems!.map((item) => (
                    <div
                      key={item.id}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg border",
                        item.done
                          ? "bg-emerald-50/50 border-emerald-100"
                          : "bg-slate-50 border-slate-100",
                      )}
                    >
                      {item.done ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                      ) : (
                        <Circle className="h-4 w-4 text-slate-300 flex-shrink-0" />
                      )}
                      <span
                        className={cn(
                          "text-sm flex-1",
                          item.done ? "text-slate-500 line-through" : "text-slate-800 font-medium",
                        )}
                      >
                        {item.label}
                      </span>
                      {item.type === "appliance" && (
                        <Badge variant="outline" className="text-[9px] border-slate-200 text-slate-500 font-bold uppercase">
                          Equipo
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-400 italic">Sin checklist configurado.</p>
            )}
          </Section>

          {/* Evidencia: cruce con evidence_criteria de la propiedad +
              galeria de fotos de cierre. Si la propiedad define que
              categorias requiere (ej. "cocina, bano, sala"), mostramos
              un checklist visual de cobertura para que el owner sepa
              de un vistazo si el staff fotografio todo lo pedido. */}
          {(() => {
            const photos = task.closurePhotos ?? [];
            const criteria = property?.evidenceCriteria ?? [];
            const hasCriteria = criteria.length > 0;
            const hasPhotos = photos.length > 0;
            if (!hasCriteria && !hasPhotos) return null;

            // Cuenta fotos por categoria — case-insensitive porque el
            // staff escribe "Cocina" y la propiedad puede tener "cocina".
            const photosByCategory = new Map<string, number>();
            for (const p of photos) {
              const k = (p.category || "").toLowerCase().trim();
              photosByCategory.set(k, (photosByCategory.get(k) ?? 0) + 1);
            }
            const covered = criteria.filter(
              (c) => (photosByCategory.get(c.toLowerCase().trim()) ?? 0) > 0,
            ).length;
            const score = hasCriteria ? `${covered}/${criteria.length}` : null;
            const incomplete = hasCriteria && covered < criteria.length;

            return (
              <Section
                icon={Camera}
                title="Evidencia visual"
                badge={
                  score
                    ? `${score} categorias`
                    : `${photos.length} ${photos.length === 1 ? "foto" : "fotos"}`
                }
                tone={incomplete ? "warning" : "default"}
              >
                {hasCriteria && (
                  <div className="mb-4 p-3 rounded-xl bg-slate-50 border border-slate-200">
                    <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-2">
                      Categorias requeridas por la propiedad
                    </p>
                    <div className="space-y-1.5">
                      {criteria.map((c) => {
                        const count = photosByCategory.get(c.toLowerCase().trim()) ?? 0;
                        const ok = count > 0;
                        return (
                          <div
                            key={c}
                            className={cn(
                              "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-sm",
                              ok
                                ? "bg-emerald-50/60 border-emerald-100 text-emerald-900"
                                : "bg-rose-50/60 border-rose-100 text-rose-900",
                            )}
                          >
                            {ok ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                            ) : (
                              <X className="h-4 w-4 text-rose-500 flex-shrink-0" />
                            )}
                            <span className="flex-1 capitalize font-medium">{c}</span>
                            <span className={cn("text-[11px] font-bold", ok ? "text-emerald-700" : "text-rose-600")}>
                              {ok ? `${count} foto${count === 1 ? "" : "s"}` : "FALTANTE"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {incomplete && (
                      <p className="text-[11px] text-rose-700 mt-2 flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                        Faltan categorias antes de validar — pedile al staff que las complete.
                      </p>
                    )}
                  </div>
                )}

                {hasPhotos ? (
                  <div className="grid grid-cols-3 gap-2">
                    {photos.map((photo, idx) => (
                      <a
                        key={idx}
                        href={photo.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="aspect-square rounded-lg overflow-hidden bg-slate-100 border border-slate-200 hover:opacity-80 transition-opacity relative group"
                      >
                        <img
                          src={photo.url}
                          alt={photo.category}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-black/80 to-transparent">
                          <p className="text-white text-[9px] font-bold uppercase truncate">
                            {photo.category}
                          </p>
                        </div>
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    <Camera className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm text-slate-500 font-medium">
                      El staff todavia no subio fotos de cierre
                    </p>
                  </div>
                )}
              </Section>
            );
          })()}

          {/* Incidencias reportadas */}
          {task.reportedIssues && task.reportedIssues.length > 0 && (
            <Section
              icon={AlertTriangle}
              title="Incidencias reportadas"
              badge={`${task.reportedIssues.length}`}
              tone="warning"
            >
              <ul className="space-y-2">
                {task.reportedIssues.map((issue, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900"
                  >
                    <Wrench className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <span>{issue}</span>
                  </li>
                ))}
              </ul>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 h-9 border-amber-200 text-amber-700 hover:bg-amber-50"
                disabled
                title="Disponible cuando este integrado el modulo de mantenimiento"
              >
                <Wrench className="h-4 w-4 mr-2" />
                Crear ticket de mantenimiento
              </Button>
            </Section>
          )}

          {/* Linea de tiempo */}
          <Section icon={History} title="Linea de tiempo">
            <ol className="relative border-l-2 border-slate-100 ml-2 space-y-4 py-1">
              {timeline.map((ev, idx) => {
                const Icon = ev.icon;
                return (
                  <li key={idx} className="ml-5">
                    <span
                      className={cn(
                        "absolute -left-[11px] flex items-center justify-center h-5 w-5 rounded-full ring-4 ring-white",
                        ev.done ? "bg-primary" : "bg-slate-200",
                      )}
                    >
                      <Icon className={cn("h-3 w-3", ev.done ? "text-white" : "text-slate-400")} />
                    </span>
                    <div className="space-y-0.5">
                      <p className={cn("text-sm font-bold", ev.done ? "text-slate-800" : "text-slate-400")}>
                        {ev.label}
                      </p>
                      {ev.detail && (
                        <p className="text-xs text-slate-500">{ev.detail}</p>
                      )}
                      {ev.timestamp && (
                        <p className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDateTime(ev.timestamp)}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </Section>
        </div>

        {/* ─── Footer actions ────────────────────────────────────────────── */}
        <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex flex-col gap-3">
          {task.status !== "completed" && (
            <Button
              variant="outline"
              className="w-full border-emerald-200 text-emerald-700 hover:bg-emerald-50 justify-center"
              onClick={handleShareAccessWithStaff}
            >
              <Send className="h-4 w-4 mr-2" />
              {assignedMember?.name
                ? `Enviar acceso a ${assignedMember.name} por WhatsApp`
                : "Compartir acceso por WhatsApp"}
            </Button>
          )}
        <div className="flex flex-col sm:flex-row gap-3">
          {task.isWaitingValidation && task.status !== "completed" ? (
            <>
              <Button
                variant="outline"
                className="flex-1 border-rose-200 text-rose-700 hover:bg-rose-50"
                onClick={() => onReopen(task.id)}
              >
                <X className="h-4 w-4 mr-2" />
                Reabrir tarea
              </Button>
              <Button
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                onClick={() => onValidate(task.id)}
              >
                <ClipboardCheck className="h-4 w-4 mr-2" />
                Validar y cerrar
              </Button>
            </>
          ) : task.status === "completed" ? (
            <Button
              variant="outline"
              className="flex-1 border-amber-200 text-amber-700 hover:bg-amber-50"
              onClick={() => onReopen(task.id)}
            >
              <X className="h-4 w-4 mr-2" />
              Reabrir tarea
            </Button>
          ) : (
            <>
              {onMarkUrgent && task.priority !== "critical" && (
                <Button
                  variant="outline"
                  className="flex-1 border-rose-200 text-rose-700 hover:bg-rose-50"
                  onClick={() => onMarkUrgent(task.id)}
                >
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  Marcar urgente
                </Button>
              )}
              <Button
                variant="outline"
                className="flex-1"
                onClick={onClose}
              >
                Cerrar
              </Button>
            </>
          )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  badge,
  children,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  badge?: string;
  children: React.ReactNode;
  tone?: "default" | "warning";
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Icon
          className={cn(
            "h-4 w-4",
            tone === "warning" ? "text-amber-600" : "text-slate-500",
          )}
        />
        <h3 className="text-xs font-black uppercase tracking-widest text-slate-600">
          {title}
        </h3>
        {badge && (
          <Badge variant="outline" className="text-[10px] h-5 border-slate-200 text-slate-600 font-bold">
            {badge}
          </Badge>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
        {label}
      </p>
      <p className="text-sm font-bold text-slate-800 truncate">{value}</p>
    </div>
  );
}
