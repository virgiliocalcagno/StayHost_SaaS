"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CreditCard, Calendar, Lock, ShieldCheck, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface PublicStripeFormProps {
  onComplete: (isValid: boolean) => void;
  total: number;
}

export default function PublicStripeForm({ onComplete, total }: PublicStripeFormProps) {
  const [method, setMethod] = useState<"card" | "paypal">("card");
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");

  const formatCard = (val: string) => {
    const v = val.replace(/\s+/g, "").replace(/[^0-9]/gi, "");
    const parts = v.match(/.{1,4}/g) || [];
    const res = parts.join(" ").substring(0, 19);
    onComplete(res.length === 19 && expiry.length === 5 && cvc.length >= 3);
    return res;
  };

  const formatExpiry = (val: string) => {
    let v = val.replace(/[^0-9]/g, "");
    if (v.length > 2) v = v.substring(0, 2) + "/" + v.substring(2, 4);
    onComplete(cardNumber.length === 19 && v.length === 5 && cvc.length >= 3);
    return v;
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Selecciona Método de Pago</Label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => { setMethod("card"); onComplete(cardNumber.length === 19 && expiry.length === 5 && cvc.length >= 3); }}
            className={cn(
              "relative flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all gap-2",
              method === "card" ? "border-[#635BFF] bg-blue-50/50 shadow-md" : "border-slate-100 bg-white hover:border-slate-200"
            )}
          >
            <CreditCard className={cn("h-6 w-6", method === "card" ? "text-[#635BFF]" : "text-slate-400")} />
            <span className={cn("text-xs font-bold", method === "card" ? "text-[#635BFF]" : "text-slate-600")}>Tarjeta</span>
            {method === "card" && (
              <div className="absolute top-2 right-2 p-0.5 bg-[#635BFF] rounded-full">
                <CheckCircle2 className="h-3 w-3 text-white" />
              </div>
            )}
          </button>
          
          <button
            type="button"
            onClick={() => { setMethod("paypal"); onComplete(true); }}
            className={cn(
              "relative flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all gap-2",
              method === "paypal" ? "border-[#0070BA] bg-blue-50/50 shadow-md" : "border-slate-100 bg-white hover:border-slate-200"
            )}
          >
            <div className="h-6 flex items-center">
              <img src="https://upload.wikimedia.org/wikipedia/commons/b/b5/PayPal.svg" className="h-4" alt="PayPal" />
            </div>
            <span className={cn("text-xs font-bold", method === "paypal" ? "text-[#0070BA]" : "text-slate-600")}>PayPal</span>
            {method === "paypal" && (
              <div className="absolute top-2 right-2 p-0.5 bg-[#0070BA] rounded-full">
                <CheckCircle2 className="h-3 w-3 text-white" />
              </div>
            )}
          </button>
        </div>
      </div>

      {method === "card" ? (
        <div className="bg-white border-2 border-slate-50 rounded-3xl p-6 space-y-5 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Número de Tarjeta</Label>
            <div className="relative">
              <Input
                placeholder="0000 0000 0000 0000"
                value={cardNumber}
                onChange={(e) => setCardNumber(formatCard(e.target.value))}
                className="h-14 bg-slate-50/50 border-none rounded-2xl focus:ring-2 focus:ring-[#635BFF]/20 font-mono text-lg"
              />
              <div className="absolute right-4 top-1/2 -translate-y-1/2 flex gap-1 items-center">
                <img src="https://upload.wikimedia.org/wikipedia/commons/5/5e/Visa_Inc._logo.svg" className="h-3 opacity-80" alt="Visa" />
                <img src="https://upload.wikimedia.org/wikipedia/commons/2/2a/Mastercard-logo.svg" className="h-4 opacity-80" alt="Mastercard" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Vence</Label>
              <Input
                placeholder="MM/YY"
                maxLength={5}
                value={expiry}
                onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                className="h-14 bg-slate-50/50 border-none rounded-2xl focus:ring-2 focus:ring-[#635BFF]/20 font-mono text-center text-lg"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">CVC</Label>
              <div className="relative">
                <Input
                  placeholder="123"
                  maxLength={4}
                  value={cvc}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, "");
                    setCvc(v);
                    onComplete(cardNumber.length === 19 && expiry.length === 5 && v.length >= 3);
                  }}
                  className="h-14 bg-slate-50/50 border-none rounded-2xl focus:ring-2 focus:ring-[#635BFF]/20 font-mono text-center text-lg"
                />
                <Lock className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-300" />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-[#0070BA]/5 border-2 border-[#0070BA]/10 rounded-3xl p-8 text-center space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
           <img src="https://upload.wikimedia.org/wikipedia/commons/b/b5/PayPal.svg" className="h-8 mx-auto" alt="PayPal" />
           <p className="text-sm font-medium text-[#002169]">Serás redirigido a PayPal para autorizar el cobro de <span className="font-black">${total.toLocaleString()}</span> de forma instantánea.</p>
           <div className="flex justify-center gap-2">
             <div className="h-2 w-2 rounded-full bg-[#0070BA] animate-bounce" style={{ animationDelay: "0ms" }} />
             <div className="h-2 w-2 rounded-full bg-[#0070BA] animate-bounce" style={{ animationDelay: "200ms" }} />
             <div className="h-2 w-2 rounded-full bg-[#0070BA] animate-bounce" style={{ animationDelay: "400ms" }} />
           </div>
        </div>
      )}

      <div className="flex items-center gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
        <ShieldCheck className="h-5 w-5 text-green-600 shrink-0" />
        <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
          El pago se enviará automáticamente a la cuenta conectada configurada: <span className="text-slate-800 font-bold tracking-tight italic">...FusZxqRmjV</span> (Verified Account). 
        </p>
      </div>
    </div>
  );
}
