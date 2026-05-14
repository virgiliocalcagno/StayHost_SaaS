"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Wallet, Calendar, CheckCircle2, AlertCircle, Banknote, Hash } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

interface WalletTask {
  taskId: string;
  propertyName: string;
  dueDate: string;
  amount: number | null;
  liquidated: boolean;
}

interface WalletWeek {
  startDate: string;
  endDate: string;
  total: number;
  tasks: WalletTask[];
}

interface WalletPayout {
  id: string;
  periodStart: string;
  periodEnd: string;
  totalAmount: number;
  currency: string;
  status: string;
  paymentMethod: string | null;
  reference: string | null;
  paidAt: string | null;
}

interface WalletData {
  cleanerName: string;
  weeks: WalletWeek[];
  weeksRequested: number;
  totalPending: number;
  currency: string;
  payouts: WalletPayout[];
  note: string;
}

const DEFAULT_WEEKS = 4;

function formatRange(start: string, end: string): string {
  const fmt = (iso: string) => {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("es", { day: "2-digit", month: "short" });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

function formatDay(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("es", { weekday: "short", day: "2-digit", month: "short" });
}

function methodLabel(m: string | null): string {
  if (!m) return "—";
  if (m === "cash") return "Efectivo";
  if (m === "transfer") return "Transferencia";
  if (m === "paypal") return "PayPal";
  return "Otro";
}

function formatPaidAt(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("es", { day: "2-digit", month: "short", year: "numeric" });
}

export default function StaffWalletPage() {
  const router = useRouter();
  const [data, setData] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/staff/wallet?weeks=${DEFAULT_WEEKS}`, { credentials: "same-origin", cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          const msg = (await r.json().catch(() => ({}))).error || `Error ${r.status}`;
          throw new Error(msg);
        }
        return r.json();
      })
      .then((d: WalletData) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "No se pudo cargar");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-[#F8F9FC] text-slate-900 pb-12">
      <div className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b px-4 py-4 flex items-center gap-3 shadow-sm">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/staff")}
          className="rounded-full h-10 w-10 border border-slate-100 bg-white shadow-sm shrink-0"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2 flex-1 justify-center pr-10">
          <Wallet className="h-4 w-4" /> Mi billetera
        </h3>
      </div>

      <div className="max-w-md mx-auto px-4 pt-6 space-y-6">
        {loading && (
          <Card className="p-6 text-center text-slate-400 text-sm">Cargando…</Card>
        )}

        {error && (
          <Card className="p-6 border-rose-200 bg-rose-50">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-rose-500 mt-0.5" />
              <div>
                <p className="font-bold text-rose-800 text-sm">No pudimos cargar tu billetera</p>
                <p className="text-rose-700 text-xs mt-1">{error}</p>
              </div>
            </div>
          </Card>
        )}

        {data && (
          <>
            <Card className="p-6 bg-gradient-to-br from-emerald-500 to-emerald-600 text-white border-none shadow-xl rounded-[2rem]">
              <p className="text-emerald-100 text-xs font-bold uppercase tracking-wider mb-1">Pendiente de pago</p>
              <p className="text-4xl font-bold mb-2">{formatCurrency(data.totalPending, data.currency)}</p>
              <p className="text-emerald-100 text-xs">
                {data.weeks.reduce((acc, w) => acc + w.tasks.length, 0)} tareas validadas en las últimas {data.weeksRequested} semanas
              </p>
            </Card>

            <Card className="p-4 bg-amber-50 border border-amber-200">
              <p className="text-amber-800 text-xs">{data.note}</p>
            </Card>

            {data.weeks.length === 0 && data.payouts.length === 0 && (
              <Card className="p-8 text-center border-dashed border-2 border-slate-200 bg-white rounded-[2rem]">
                <Wallet className="h-12 w-12 text-slate-200 mx-auto mb-3" />
                <p className="font-bold text-slate-500 text-sm">Sin tareas validadas aún</p>
                <p className="text-slate-400 text-xs mt-1">
                  Cuando el supervisor valide tus limpiezas, vas a verlas acá.
                </p>
              </Card>
            )}

            {data.weeks.map((wk) => (
              <Card key={wk.startDate} className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                  <div className="flex items-center gap-2 text-slate-700">
                    <Calendar className="h-4 w-4 text-slate-400" />
                    <span className="text-sm font-bold">Semana {formatRange(wk.startDate, wk.endDate)}</span>
                  </div>
                  <span className="font-bold text-slate-800 text-sm">{formatCurrency(wk.total, data.currency)}</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {wk.tasks.map((t) => (
                    <div
                      key={t.taskId}
                      className={cn(
                        "px-4 py-3 flex items-center justify-between gap-3",
                        t.liquidated && "bg-slate-50/60",
                      )}
                    >
                      <div className="min-w-0">
                        <p
                          className={cn(
                            "text-sm font-semibold truncate",
                            t.liquidated ? "text-slate-500" : "text-slate-800",
                          )}
                        >
                          {t.propertyName}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1.5">
                          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                          {formatDay(t.dueDate)}
                        </p>
                      </div>
                      <div className="text-right shrink-0 flex flex-col items-end gap-1">
                        {t.amount != null ? (
                          <span
                            className={cn(
                              "font-bold text-sm",
                              t.liquidated ? "text-slate-400 line-through" : "text-slate-800",
                            )}
                          >
                            {formatCurrency(t.amount, data.currency)}
                          </span>
                        ) : (
                          <Badge variant="outline" className={cn("text-[10px] border-amber-200 bg-amber-50 text-amber-700")}>
                            sin precio
                          </Badge>
                        )}
                        {t.liquidated && (
                          <Badge
                            variant="outline"
                            className="text-[10px] border-emerald-200 bg-emerald-50 text-emerald-700"
                          >
                            Liquidada
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ))}

            {data.payouts.length > 0 && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-2 px-1">
                  <Banknote className="h-4 w-4 text-slate-500" />
                  <h4 className="font-bold text-slate-700 text-sm">Cortes pagados</h4>
                </div>
                {data.payouts.map((p) => {
                  const isPaid = p.status === "paid";
                  const isCancelled = p.status === "cancelled";
                  return (
                    <Card
                      key={p.id}
                      className={cn(
                        "bg-white rounded-2xl border overflow-hidden",
                        isPaid && "border-emerald-200",
                        isCancelled && "border-slate-200 opacity-70",
                        !isPaid && !isCancelled && "border-amber-200",
                      )}
                    >
                      <div className="px-4 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-800 truncate">
                            {formatRange(p.periodStart, p.periodEnd)}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {isPaid && p.paidAt ? `Pagado el ${formatPaidAt(p.paidAt)}` : null}
                            {!isPaid && !isCancelled ? "Pendiente de pago" : null}
                            {isCancelled ? "Cancelado" : null}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p
                            className={cn(
                              "font-bold text-sm",
                              isCancelled && "line-through text-slate-400",
                              isPaid && "text-emerald-700",
                              !isPaid && !isCancelled && "text-slate-800",
                            )}
                          >
                            {formatCurrency(p.totalAmount, p.currency)}
                          </p>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] mt-1",
                              isPaid && "border-emerald-200 bg-emerald-50 text-emerald-700",
                              !isPaid && !isCancelled && "border-amber-200 bg-amber-50 text-amber-700",
                              isCancelled && "border-slate-200 bg-slate-50 text-slate-500",
                            )}
                          >
                            {isPaid ? "Pagado" : isCancelled ? "Cancelado" : "Pendiente"}
                          </Badge>
                        </div>
                      </div>
                      {isPaid && (p.paymentMethod || p.reference) && (
                        <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/60 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
                          {p.paymentMethod && (
                            <span className="flex items-center gap-1">
                              <Banknote className="h-3 w-3 text-slate-400" />
                              {methodLabel(p.paymentMethod)}
                            </span>
                          )}
                          {p.reference && (
                            <span className="flex items-center gap-1 min-w-0">
                              <Hash className="h-3 w-3 text-slate-400 shrink-0" />
                              <span className="truncate">ref {p.reference}</span>
                            </span>
                          )}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
