"use client";

import React, { useState } from "react";
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
} from "lucide-react";
import { CleaningTask, getPriorityInfo } from "@/types/staff";

export interface StaffWizardProps {
  task: CleaningTask;
  activeCriteria: string[];
  onClose: () => void;
  onSubmit: (taskId: string, photos: { category: string; url: string }[], notes: string) => void;
  onToggleChecklist?: (taskId: string, itemId: string) => void;
}

export function StaffWizard({ task, activeCriteria, onClose, onSubmit, onToggleChecklist }: StaffWizardProps) {
  const [wizardStep, setWizardStep] = useState(1);
  const [tempPhotos, setTempPhotos] = useState<{ category: string; url: string }[]>([]);
  const [notes, setNotes] = useState("");
  // Estado local para checklist (si no se pasa handler externo, maneja el estado internamente)
  const [localChecklist, setLocalChecklist] = useState(task.checklistItems || []);

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

  const handleUploadPhoto = (category: string) => {
    // Simula subida de foto
    const mockUrl = "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=400&h=300&fit=crop";
    setTempPhotos(prev => {
      const exists = prev.find(p => p.category === category);
      if (exists) return prev;
      return [...prev, { category, url: mockUrl }];
    });
  };

  const handleSubmitTask = () => {
    onSubmit(task.id, tempPhotos, notes);
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

        <div className="h-10 w-10 flex items-center justify-center bg-primary/10 rounded-full">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
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

        {/* Wizard Step Content */}
        <div className="animate-in slide-in-from-right-4 duration-500">
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
                 <Label className="text-sm font-bold text-slate-700 mb-3 block">¿Alguna novedad o daño?</Label>
                 <textarea 
                    placeholder="Escribe aquí si falta algo o hay daños..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full h-28 p-4 rounded-2xl border border-slate-100 bg-slate-50 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                 />
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
                      return (
                        <div key={cat} className="group relative">
                          <div className={cn(
                            "p-4 rounded-2xl border-2 border-dashed transition-all flex items-center justify-between",
                            photo ? "bg-emerald-50 border-emerald-500" : "bg-slate-50 border-slate-200 hover:border-primary/50"
                          )}>
                            <div className="flex items-center gap-3">
                               {photo ? (
                                 <img src={photo.url} className="h-12 w-12 rounded-xl object-cover shadow-md border-2 border-white" alt={`Evidencia ${cat}`}/>
                               ) : (
                                 <div className="h-12 w-12 bg-white rounded-xl flex items-center justify-center shadow-sm">
                                    <ImageIcon className="h-5 w-5 text-slate-300" />
                                 </div>
                               )}
                               <div>
                                  <p className="font-bold text-slate-700 text-sm">{cat}</p>
                                  <p className="text-[10px] items-center flex gap-1 text-slate-400 font-bold">
                                    {photo ? <span className="text-emerald-600 flex items-center gap-1"><Check className="h-2 w-2" /> LISTO</span> : "OBLIGATORIO"}
                                  </p>
                               </div>
                            </div>
                            <Button 
                              size="icon"
                              onClick={() => handleUploadPhoto(cat)}
                              className={cn(
                                "h-10 w-10 rounded-full shadow-lg",
                                photo ? "bg-emerald-500 hover:bg-emerald-600" : "gradient-gold shadow-primary/20"
                              )}
                            >
                              {photo ? <Check className="h-5 w-5 text-white" /> : <Camera className="h-5 w-5 text-primary-foreground" />}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
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
                    disabled={tempPhotos.length < activeCriteria.length}
                    className="flex-[2] h-14 rounded-2xl bg-slate-900 hover:bg-black text-white font-bold shadow-xl shadow-black/20 disabled:opacity-50" 
                    onClick={handleSubmitTask}
                 >
                   Enviar y Terminar
                 </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
