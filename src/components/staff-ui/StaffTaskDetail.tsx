"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Bed,
  CheckCircle2,
  AlertTriangle,
  X,
  Check,
  FileText,
  KeyRound,
  Lock,
  MapPin,
  Phone,
  MessageCircle,
  Wifi,
  User,
  Copy,
} from "lucide-react";
import { CleaningTask, getPriorityInfo } from "@/types/staff";
import { buildHelpMessage } from "@/lib/staff-help/buildHelpMessage";

export interface StaffTaskDetailProps {
  task: CleaningTask;
  bedConfiguration?: string;
  ownerWhatsapp?: string | null;
  staffName?: string | null;
  onClose: () => void;
  onAccept: (taskId: string) => void;
  onDecline: (taskId: string, reason: string) => void;
  onStartCleaning: (taskId: string) => void;
}

// Normaliza número a dígitos para tel: y wa.me. Asume internacional (con +)
// si arranca por +, sino lo deja como está (los hosts LATAM suelen guardar
// números con código de país sin +).
const toDigits = (raw: string) => raw.replace(/[^\d]/g, "");
const buildMapsUrl = (address: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

export function StaffTaskDetail({
  task,
  bedConfiguration,
  ownerWhatsapp,
  staffName,
  onClose,
  onAccept,
  onDecline,
  onStartCleaning,
}: StaffTaskDetailProps) {
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const priority = getPriorityInfo(task);
  // Por privacidad del huésped, el staff sólo ve el primer nombre, sin
  // apellido y sin teléfono. Si necesita comunicarse, lo coordina vía
  // supervisor — botón "Pedir ayuda" más abajo.
  const guestFirstName = (task.guestName || "").trim().split(/\s+/)[0] || null;
  const ownerDigits = ownerWhatsapp ? toDigits(ownerWhatsapp) : null;

  const copy = (label: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FC] pb-20 animate-in slide-in-from-bottom duration-500">
      <div className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b px-6 py-4 flex items-center gap-4 shadow-sm">
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="rounded-full h-11 w-11 border border-slate-100 bg-white shadow-sm"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h3 className="font-bold text-slate-800">Detalle de Limpieza</h3>
      </div>

      <div className="max-w-md mx-auto px-5 pt-6 space-y-6">
        {/* HERO */}
        <Card className="border-none shadow-xl rounded-[2rem] overflow-hidden bg-white">
          <div className="h-48 relative bg-slate-100">
            <img
              src={task.propertyImage || "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=400"}
              className="w-full h-full object-cover"
              alt="Propiedad"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent flex items-end p-6">
              <div className="w-full">
                <Badge
                  className={cn(
                    "border-none mb-2",
                    priority.color,
                    priority.isUrgent && "animate-pulse font-black"
                  )}
                >
                  {priority.label}
                </Badge>
                <h2 className="text-white text-2xl font-black leading-tight">
                  {task.propertyName}
                </h2>
                {task.address && (
                  <a
                    href={buildMapsUrl(task.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1.5 text-white/90 text-sm font-semibold underline-offset-2 hover:underline"
                  >
                    <MapPin className="h-4 w-4" />
                    <span className="line-clamp-2">{task.address}</span>
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="p-6 space-y-5">
            {/* Metadata grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                  Hora de Salida
                </p>
                <p className="text-lg font-bold text-slate-800">{task.dueTime}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                  Huésped
                </p>
                <p className="text-lg font-bold text-slate-800 truncate">{guestFirstName ?? "Reserva"}</p>
              </div>
              {task.guestCount && (
                <div className="space-y-1">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                    Huéspedes
                  </p>
                  <p className="text-lg font-bold text-slate-800">{task.guestCount}</p>
                </div>
              )}
              {task.stayDuration && (
                <div className="space-y-1">
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
                    Noches
                  </p>
                  <p className="text-lg font-bold text-slate-800">{task.stayDuration}</p>
                </div>
              )}
            </div>

            {/* Re-trabajo solicitado por el supervisor. Cuando el supervisor
                rechaza el cierre con "Pedir re-foto", la nota queda visible
                acá hasta que el cleaner re-envíe la evidencia y el supervisor
                la valide (handleValidateTask limpia rejection_note). */}
            {task.rejectionNote && (
              <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-300 flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-black text-amber-700 uppercase tracking-widest mb-1">
                    El supervisor te pidió revisión
                  </p>
                  <p className="text-sm text-amber-900 leading-snug">
                    {task.rejectionNote}
                  </p>
                </div>
              </div>
            )}

            {/* ACCESO — PIN TTLock o keybox o "esperar contacto". Lo más
                importante de la pantalla: sin esto el staff no puede entrar. */}
            <AccessBlock task={task} onCopy={copy} copiedLabel={copied} />

            {/* Ropa de cama a preparar */}
            {bedConfiguration && (
              <div className="p-4 rounded-2xl bg-primary/5 border border-primary/10">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Bed className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-[11px] font-black text-primary uppercase tracking-widest mb-0.5">
                      Ropa de Cama a Preparar
                    </p>
                    <p className="text-sm font-bold text-slate-800">{bedConfiguration}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Back-to-back alert con hora de check-in del próximo */}
            {task.isBackToBack && (
              <div className="space-y-3">
                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 flex items-center gap-3 animate-pulse">
                  <AlertTriangle className="h-5 w-5 text-rose-500 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-black text-rose-700 uppercase tracking-wider">
                      Back-to-Back
                    </p>
                    <p className="text-xs text-rose-600 mt-0.5">
                      Hay check-in hoy{task.arrivingCheckInTime ? ` a las ${task.arrivingCheckInTime}` : ""}.
                      Prioridad máxima.
                    </p>
                  </div>
                </div>
                {task.arrivingGuestName && (
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-2">
                      Próximo Huésped
                    </p>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full bg-emerald-500" />
                        <p className="text-sm font-bold text-slate-800">
                          {task.arrivingGuestName}
                        </p>
                      </div>
                      {task.arrivingGuestCount && (
                        <Badge
                          variant="outline"
                          className="text-[11px] border-slate-200 text-slate-500"
                        >
                          {task.arrivingGuestCount} pax
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {task.isVacant && (
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                <div>
                  <p className="text-xs font-black text-emerald-700 uppercase tracking-wider">
                    Propiedad Vacante
                  </p>
                  <p className="text-xs text-emerald-600">
                    Sin check-in hoy. Puedes organizar tu tiempo.
                  </p>
                </div>
              </div>
            )}

            {/* Accept / Reject flow */}
            {task.acceptanceStatus === "pending" ? (
              rejectMode ? (
                <div className="space-y-3 animate-in fade-in zoom-in-95">
                  <p className="text-sm font-bold text-slate-700">
                    ¿Por qué no puedes realizar esta tarea?
                  </p>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Ej: No tengo transporte disponible, emergencia personal…"
                    rows={3}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-slate-50 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-rose-200 transition-all"
                  />
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      className="flex-1 h-12 rounded-2xl border-slate-200 font-bold"
                      onClick={() => {
                        setRejectMode(false);
                        setRejectReason("");
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button
                      className="flex-1 h-12 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-bold disabled:opacity-50"
                      disabled={!rejectReason.trim()}
                      onClick={() => {
                        onDecline(task.id, rejectReason);
                        setRejectMode(false);
                        setRejectReason("");
                      }}
                    >
                      Confirmar Rechazo
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-4">
                  <Button
                    variant="outline"
                    className="flex-1 h-14 rounded-2xl border-rose-200 text-rose-500 font-bold hover:bg-rose-50"
                    onClick={() => setRejectMode(true)}
                  >
                    <X className="h-5 w-5 mr-2" /> Rechazar
                  </Button>
                  <Button
                    className={cn(
                      "flex-[2] h-14 rounded-2xl text-white font-bold shadow-xl transition-all",
                      priority.isUrgent
                        ? "bg-rose-600 hover:bg-rose-700 shadow-rose-100"
                        : "bg-emerald-500 hover:bg-emerald-600 shadow-emerald-100"
                    )}
                    onClick={() => onAccept(task.id)}
                  >
                    <Check className="h-5 w-5 mr-2" /> Aceptar Tarea
                  </Button>
                </div>
              )
            ) : (
              <Button
                className="w-full h-14 rounded-2xl gradient-gold text-primary-foreground font-black text-base shadow-2xl shadow-primary/30 active:scale-[0.98] transition-transform"
                onClick={() => onStartCleaning(task.id)}
              >
                Marcar Inicio de Limpieza
              </Button>
            )}
          </div>
        </Card>

        {/* CONTACTOS — sólo supervisor / admin. Por privacidad del huésped,
            el staff NO ve el teléfono ni nombre completo del huésped. Si
            necesita avisar algo al huésped, lo coordina vía supervisor. */}
        {ownerDigits && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest px-1 flex items-center gap-2">
              <Phone className="h-3.5 w-3.5" />
              Pedir ayuda
            </h4>
            <div className="bg-white p-4 rounded-[1.75rem] border border-slate-100 space-y-2">
              <ContactRow
                icon={<User className="h-5 w-5 text-primary" />}
                label="Supervisor"
                name="Avisar al supervisor"
                digits={ownerDigits}
                raw={ownerWhatsapp!}
                whatsappMessage={buildHelpMessage({
                  staffName,
                  propertyName: task.propertyName,
                  dueTime: task.dueTime,
                })}
                primary
              />
            </div>
          </div>
        )}

        {/* WIFI */}
        {(task.wifiName || task.wifiPassword) && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest px-1 flex items-center gap-2">
              <Wifi className="h-3.5 w-3.5" />
              Wifi de la propiedad
            </h4>
            <div className="bg-white p-4 rounded-[1.75rem] border border-slate-100 grid grid-cols-2 gap-3">
              {task.wifiName && (
                <button
                  onClick={() => copy("wifi-name", task.wifiName!)}
                  className="text-left p-3 rounded-xl bg-slate-50 hover:bg-slate-100 active:scale-[0.98] transition-all"
                >
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">
                    Red
                  </p>
                  <p className="text-sm font-bold text-slate-800 truncate flex items-center gap-1.5">
                    {task.wifiName}
                    <Copy className="h-3 w-3 text-slate-300 flex-shrink-0" />
                  </p>
                  {copied === "wifi-name" && (
                    <p className="text-[10px] text-emerald-600 font-bold mt-0.5">Copiado</p>
                  )}
                </button>
              )}
              {task.wifiPassword && (
                <button
                  onClick={() => copy("wifi-pwd", task.wifiPassword!)}
                  className="text-left p-3 rounded-xl bg-slate-50 hover:bg-slate-100 active:scale-[0.98] transition-all"
                >
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">
                    Clave
                  </p>
                  <p className="text-sm font-bold text-slate-800 truncate flex items-center gap-1.5 font-mono">
                    {task.wifiPassword}
                    <Copy className="h-3 w-3 text-slate-300 flex-shrink-0" />
                  </p>
                  {copied === "wifi-pwd" && (
                    <p className="text-[10px] text-emerald-600 font-bold mt-0.5">Copiado</p>
                  )}
                </button>
              )}
            </div>
          </div>
        )}

        {/* INSTRUCCIONES */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest px-1 flex items-center gap-2">
            <FileText className="h-3.5 w-3.5" />
            Instrucciones de Limpieza
          </h4>
          <div className="bg-white p-5 rounded-[1.75rem] border border-slate-100">
            {task.standardInstructions ? (
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                {task.standardInstructions}
              </p>
            ) : (
              <p className="text-sm text-slate-400 italic">
                El anfitrión no dejó instrucciones específicas. Sigue el checklist estándar.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Acceso a la propiedad — bloque que cambia según `accessMethod`.
// El PIN aparece sólo cuando la tarea ya fue aceptada (acceptanceStatus !=
// pending) — antes de aceptar no tiene sentido entregarlo y evita filtrar
// el código a quien rechace.
function AccessBlock({
  task,
  onCopy,
  copiedLabel,
}: {
  task: CleaningTask;
  onCopy: (label: string, text: string) => void;
  copiedLabel: string | null;
}) {
  const accepted = task.acceptanceStatus !== "pending";
  const method = task.accessMethod ?? null;

  // TTLock: PIN dinámico generado por staff_property_access. Solo visible
  // tras aceptar — si no, mostramos un placeholder.
  if (method === "ttlock") {
    return (
      <div className="p-4 rounded-2xl bg-violet-50 border border-violet-200">
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
            <KeyRound className="h-5 w-5 text-violet-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-black text-violet-700 uppercase tracking-widest mb-1">
              Cerradura electrónica
            </p>
            {accepted && task.accessPin ? (
              <button
                onClick={() => onCopy("pin", task.accessPin!)}
                className="text-left w-full"
              >
                <p className="text-3xl font-black tracking-[0.2em] text-violet-900 font-mono">
                  {task.accessPin}
                </p>
                <p className="text-[11px] text-violet-700 font-bold mt-1 flex items-center gap-1">
                  <Copy className="h-3 w-3" />
                  {copiedLabel === "pin" ? "Copiado al portapapeles" : "Tocar para copiar"}
                </p>
              </button>
            ) : !accepted ? (
              <p className="text-sm text-violet-700 font-semibold">
                Acepta la tarea para ver el código.
              </p>
            ) : (
              <p className="text-sm text-rose-600 font-semibold">
                No tienes PIN asignado para esta propiedad. Llama al anfitrión.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (method === "keybox") {
    return (
      <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200">
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
            <Lock className="h-5 w-5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-black text-amber-700 uppercase tracking-widest mb-1">
              Caja de llaves
            </p>
            {task.keyboxCode ? (
              <button
                onClick={() => onCopy("keybox", task.keyboxCode!)}
                className="text-left w-full"
              >
                <p className="text-3xl font-black tracking-[0.2em] text-amber-900 font-mono">
                  {task.keyboxCode}
                </p>
                <p className="text-[11px] text-amber-700 font-bold mt-1 flex items-center gap-1">
                  <Copy className="h-3 w-3" />
                  {copiedLabel === "keybox" ? "Copiado al portapapeles" : "Tocar para copiar"}
                </p>
              </button>
            ) : (
              <p className="text-sm text-amber-800 font-semibold">
                Código no configurado. Llama al anfitrión.
              </p>
            )}
            {task.keyboxLocation && (
              <p className="text-xs text-amber-800 font-medium mt-2 leading-relaxed">
                <span className="font-bold">Ubicación:</span> {task.keyboxLocation}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (method === "in_person" || method === "doorman") {
    return (
      <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-xl bg-slate-200 flex items-center justify-center flex-shrink-0">
            <User className="h-5 w-5 text-slate-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-black text-slate-600 uppercase tracking-widest mb-1">
              {method === "doorman" ? "Conserje / Recepción" : "Entrega en persona"}
            </p>
            <p className="text-sm text-slate-700 font-semibold">
              Coordina la llegada con el anfitrión por WhatsApp antes de salir.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Fallback: el host no configuró método de acceso.
  return (
    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200">
      <div className="flex items-start gap-3">
        <div className="h-11 w-11 rounded-xl bg-slate-200 flex items-center justify-center flex-shrink-0">
          <KeyRound className="h-5 w-5 text-slate-500" />
        </div>
        <div className="flex-1">
          <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-1">
            Acceso
          </p>
          <p className="text-sm text-slate-700 font-semibold">
            Coordina con el anfitrión cómo entrar a la propiedad.
          </p>
        </div>
      </div>
    </div>
  );
}

// Fila de contacto con dos CTAs: Llamar (tel:) y WhatsApp (wa.me).
function ContactRow({
  icon,
  label,
  name,
  digits,
  raw,
  primary,
  whatsappMessage,
}: {
  icon: React.ReactNode;
  label: string;
  name: string;
  digits: string;
  raw: string;
  primary?: boolean;
  whatsappMessage?: string;
}) {
  const display = raw.startsWith("+") ? raw : `+${digits}`;
  const waHref = whatsappMessage
    ? `https://wa.me/${digits}?text=${encodeURIComponent(whatsappMessage)}`
    : `https://wa.me/${digits}`;
  return (
    <div className="flex items-center gap-3 p-2">
      <div
        className={cn(
          "h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0",
          primary ? "bg-primary/10" : "bg-slate-100"
        )}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</p>
        <p className="text-sm font-bold text-slate-800 truncate">{name}</p>
        <p className="text-[11px] text-slate-500 font-mono">{display}</p>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <a
          href={`tel:${digits}`}
          className="h-11 w-11 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95 transition-all flex items-center justify-center"
          aria-label="Llamar"
        >
          <Phone className="h-5 w-5 text-slate-700" />
        </a>
        <a
          href={waHref}
          target="_blank"
          rel="noopener noreferrer"
          className="h-11 w-11 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:scale-95 transition-all flex items-center justify-center"
          aria-label="WhatsApp"
        >
          <MessageCircle className="h-5 w-5 text-white" />
        </a>
      </div>
    </div>
  );
}
