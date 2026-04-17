"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Clock,
  Bed,
  CheckCircle2,
  AlertTriangle,
  X,
  Check,
  FileText,
} from "lucide-react";
import { CleaningTask, getPriorityInfo } from "@/types/staff";

export interface StaffTaskDetailProps {
  task: CleaningTask;
  bedConfiguration?: string;
  onClose: () => void;
  onAccept: (taskId: string) => void;
  onDecline: (taskId: string, reason: string) => void;
  onStartCleaning: (taskId: string) => void;
}

export function StaffTaskDetail({ 
  task, 
  bedConfiguration, 
  onClose, 
  onAccept, 
  onDecline, 
  onStartCleaning 
}: StaffTaskDetailProps) {
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  return (
    <div className="min-h-screen bg-[#F8F9FC] pb-20 animate-in slide-in-from-bottom duration-500">
       <div className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b px-6 py-4 flex items-center gap-4 shadow-sm">
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full h-10 w-10 border border-slate-100 bg-white shadow-sm">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h3 className="font-bold text-slate-800">Detalle de Limpieza</h3>
       </div>

       <div className="max-w-md mx-auto px-6 pt-8 space-y-8">
          <Card className="border-none shadow-xl rounded-[2.5rem] overflow-hidden bg-white">
             <div className="h-56 relative bg-slate-100">
                <img src={task.propertyImage || "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=400"} className="w-full h-full object-cover" alt="Property" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent flex items-end p-8">
                   <div>
                      <Badge className={cn("border-none mb-2", getPriorityInfo(task).color, getPriorityInfo(task).isUrgent && "animate-pulse font-black")}>
                        {getPriorityInfo(task).label}
                      </Badge>
                      <h2 className="text-white text-2xl font-black leading-tight">{task.propertyName}</h2>
                      <p className="text-white/70 text-sm font-medium">{task.address}</p>
                   </div>
                </div>
             </div>
             
             <div className="p-8 space-y-6">
                {/* Metadata grid */}
                <div className="grid grid-cols-2 gap-4">
                   <div className="space-y-1">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Hora de Salida</p>
                      <p className="text-lg font-bold text-slate-800">{task.dueTime}</p>
                   </div>
                   <div className="space-y-1">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Huésped</p>
                      <p className="text-lg font-bold text-slate-800 truncate">{task.guestName}</p>
                   </div>
                   {task.guestCount && (
                     <div className="space-y-1">
                       <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Huéspedes</p>
                       <p className="text-lg font-bold text-slate-800">{task.guestCount}</p>
                     </div>
                   )}
                   {task.stayDuration && (
                     <div className="space-y-1">
                       <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Noches</p>
                       <p className="text-lg font-bold text-slate-800">{task.stayDuration}</p>
                     </div>
                   )}
                </div>

                {/* Bed configuration — clave para preparar suministros */}
                {bedConfiguration && (
                  <div className="p-4 rounded-2xl bg-primary/5 border border-primary/10">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Bed className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-primary uppercase tracking-widest mb-0.5">Ropa de Cama a Preparar</p>
                        <p className="text-sm font-bold text-slate-800">
                          {bedConfiguration}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Back-to-back alert */}
                {task.isBackToBack && (
                  <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 flex items-center gap-3 animate-pulse">
                    <AlertTriangle className="h-5 w-5 text-rose-500 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-black text-rose-700 uppercase tracking-wider">⚡ Back-to-Back</p>
                      <p className="text-[11px] text-rose-600">Hay check-in hoy. Prioridad máxima.</p>
                    </div>
                  </div>
                )}

                {/* Vacant property info */}
                {task.isVacant && (
                  <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-black text-emerald-700 uppercase tracking-wider">✓ Propiedad Vacante</p>
                      <p className="text-[11px] text-emerald-600">Sin check-in hoy. Puedes organizar tu tiempo.</p>
                    </div>
                  </div>
                )}

                {/* Accept / Reject flow */}
                {task.acceptanceStatus === "pending" ? (
                  rejectMode ? (
                    <div className="space-y-3 animate-in fade-in zoom-in-95">
                      <p className="text-sm font-bold text-slate-700">¿Por qué no puedes realizar esta tarea?</p>
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
                          onClick={() => { setRejectMode(false); setRejectReason(""); }}
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
                        className="flex-1 h-16 rounded-[1.5rem] border-rose-200 text-rose-500 font-bold hover:bg-rose-50"
                        onClick={() => setRejectMode(true)}
                      >
                        <X className="h-5 w-5 mr-2" /> Rechazar
                      </Button>
                      <Button
                        className={cn(
                          "flex-[2] h-16 rounded-[1.5rem] text-white font-bold shadow-xl transition-all",
                          getPriorityInfo(task).isUrgent
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
                    className="w-full h-16 rounded-[1.5rem] gradient-gold text-primary-foreground font-black text-lg shadow-2xl shadow-primary/30 active:scale-[0.98] transition-transform"
                    onClick={() => onStartCleaning(task.id)}
                  >
                    Marcar Inicio de Limpieza
                  </Button>
                )}
             </div>
          </Card>

          {/* Instrucciones Base (dinámicas desde la propiedad) */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest px-1 flex items-center gap-2">
              <FileText className="h-3.5 w-3.5" />
              Instrucciones de Limpieza
            </h4>
            <div className="bg-white p-6 rounded-[2rem] shadow-soft border border-slate-100">
              {task.standardInstructions ? (
                <p className="text-sm text-slate-700 leading-relaxed">{task.standardInstructions}</p>
              ) : (
                <p className="text-sm text-slate-400 italic">
                  "Verificar que el aire acondicionado esté apagado antes de salir y reportar cualquier daño visible."
                </p>
              )}
            </div>
          </div>
       </div>
    </div>
  );
}
