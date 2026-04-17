"use client";

import { useState } from "react";
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetDescription,
  SheetFooter
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { 
  CreditCard, 
  DollarSign, 
  Zap, 
  Car, 
  Sparkles, 
  User,
  ShieldCheck,
  CheckCircle2
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ChargeServiceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  bookingData: {
    id: string;
    guest: string;
    property: string;
    total?: number;
  } | null;
}

export default function ChargeServiceDrawer({ isOpen, onClose, bookingData }: ChargeServiceDrawerProps) {
  const [amount, setAmount] = useState<string>("");
  const [concept, setConcept] = useState<string>("shuttle");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Conceptos predefinidos (como en iGMS)
  const concepts = [
    { id: "shuttle", label: "Transporte / Shuttle", icon: Car },
    { id: "cleaning", label: "Limpieza Extra", icon: Sparkles },
    { id: "late_checkout", label: "Late Checkout", icon: Zap },
    { id: "other", label: "Otros Servicios", icon: DollarSign },
  ];

  const handleCharge = () => {
    setIsProcessing(true);
    // Simulación de procesamiento con Stripe Connect
    setTimeout(() => {
      setIsProcessing(false);
      setIsSuccess(true);
      setTimeout(() => {
        onClose();
        setIsSuccess(false);
        setAmount("");
      }, 2000);
    }, 1500);
  };

  if (!bookingData) return null;

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="sm:max-w-md border-l-0 shadow-2xl flex flex-col p-0">
        <SheetHeader className="px-6 py-8 pb-4 border-b bg-primary/5">
          <div className="flex items-center gap-2 mb-2">
            <div className="bg-[#635BFF] p-1 rounded text-white italic font-extrabold text-[10px]">stripe</div>
            <Badge variant="outline" className="text-[10px] uppercase font-bold text-primary border-primary/20">Pago Conectado</Badge>
          </div>
          <SheetTitle className="text-2xl font-black">Cobrar Servicio Extra</SheetTitle>
          <SheetDescription>
            Genera un cargo adicional para la reserva de <strong>{bookingData.guest}</strong>.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          
          {/* Info de la Reserva */}
          <div className="flex items-center gap-4 p-4 rounded-2xl bg-muted/50 border border-border/50">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold">{bookingData.guest}</p>
              <p className="text-xs text-muted-foreground">{bookingData.property}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Concepto del Servicio</Label>
              <Select value={concept} onValueChange={setConcept}>
                <SelectTrigger className="h-12 border-border/50 rounded-xl bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {concepts.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="font-medium">
                      <div className="flex items-center gap-2">
                        <c.icon className="h-4 w-4 text-muted-foreground" />
                        {c.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Monto a Cobrar ($)</Label>
              <div className="relative">
                <Input 
                  type="number" 
                  placeholder="0.00" 
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-14 text-2xl font-black pl-10 border-border/50 rounded-xl focus-visible:ring-primary/20" 
                />
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-[10px] text-muted-foreground text-right">Se aplicará a la cuenta terminada en ...RmjV</p>
            </div>
          </div>

          {/* Seguridad */}
          <div className="p-4 rounded-xl bg-green-500/5 border border-green-500/10 flex gap-3">
            <ShieldCheck className="h-5 w-5 text-green-600 shrink-0" />
            <p className="text-[11px] text-green-700 leading-relaxed font-medium">
              El cargo se procesará instantáneamente usando la tarjeta guardada del huésped. Se enviará un recibo automático por email.
            </p>
          </div>
        </div>

        <SheetFooter className="px-6 py-6 border-t bg-muted/10">
          <Button 
            className="w-full h-14 bg-[#635BFF] hover:bg-[#4b44cc] text-white font-black text-lg gap-3 shadow-lg shadow-blue-500/20"
            disabled={!amount || isProcessing || isSuccess}
            onClick={handleCharge}
          >
            {isProcessing ? (
              <>Procesando...</>
            ) : isSuccess ? (
              <><CheckCircle2 className="h-6 w-6" /> ¡COBRADO!</>
            ) : (
              <><CreditCard className="h-6 w-6" /> PROCESAR PAGO</>
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
