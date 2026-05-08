"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, cn } from "@/lib/utils";
import {
  Wallet,
  Plus,
  CheckCircle2,
  AlertCircle,
  Calendar as CalendarIcon,
  ChevronDown,
  X,
  RefreshCw,
} from "lucide-react";
import { todayIso, addDays, mondayOf } from "@/lib/date-utils";

interface Payout {
  id: string;
  memberId: string;
  memberName: string;
  periodStart: string;
  periodEnd: string;
  totalAmount: number;
  currency: string;
  status: "pending" | "paid" | "cancelled";
  paymentMethod: string | null;
  reference: string | null;
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
}

interface PreviewItem {
  taskId: string;
  propertyName: string;
  dueDate: string;
  validatedAt: string;
  amount: number;
}
interface PreviewBucket {
  memberId: string;
  memberName: string;
  memberRole: string;
  employmentType: string;
  total: number;
  currency: string;
  itemCount: number;
  items: PreviewItem[];
}

type Filter = "all" | "pending" | "paid";

export default function PayoutsPanel() {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewerRole, setViewerRole] = useState<string>("admin");
  const [filter, setFilter] = useState<Filter>("all");
  const [showWizard, setShowWizard] = useState(false);
  const [markingPaid, setMarkingPaid] = useState<Payout | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/payouts", {
        cache: "no-store",
        credentials: "include",
      });
      if (!r.ok) {
        const msg = (await r.json().catch(() => ({}))).error || `Error ${r.status}`;
        throw new Error(msg);
      }
      const data = (await r.json()) as { payouts: Payout[]; viewerRole: string };
      setPayouts(data.payouts ?? []);
      setViewerRole(data.viewerRole);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return payouts;
    return payouts.filter(p => p.status === filter);
  }, [payouts, filter]);

  const stats = useMemo(() => {
    const pending = payouts.filter(p => p.status === "pending");
    const paid = payouts.filter(p => p.status === "paid");
    const totalPending = pending.reduce((s, p) => s + p.totalAmount, 0);
    const totalPaid = paid.reduce((s, p) => s + p.totalAmount, 0);
    const currency = payouts[0]?.currency ?? "DOP";
    return {
      pendingCount: pending.length,
      paidCount: paid.length,
      totalPending,
      totalPaid,
      currency,
    };
  }, [payouts]);

  const isAdmin = viewerRole === "admin";

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Pagos al equipo</h2>
          <p className="text-muted-foreground">
            {isAdmin
              ? "Generá cortes semanales y registrá los pagos a tu equipo (efectivo, transferencia, etc.)."
              : "Pagos de los miembros de tu equipo (solo lectura)."}
          </p>
        </div>
        {isAdmin && (
          <Button
            onClick={() => setShowWizard(true)}
            className="gradient-gold text-primary-foreground gap-2"
          >
            <Plus className="h-4 w-4" />
            Generar corte
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Pendientes</p>
            <p className="text-2xl font-bold mt-1">{stats.pendingCount}</p>
            <p className="text-xs text-amber-600 font-semibold mt-1">
              {formatCurrency(stats.totalPending, stats.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Pagados</p>
            <p className="text-2xl font-bold mt-1">{stats.paidCount}</p>
            <p className="text-xs text-emerald-600 font-semibold mt-1">
              {formatCurrency(stats.totalPaid, stats.currency)}
            </p>
          </CardContent>
        </Card>
        <Card className="col-span-2 sm:col-span-2">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10">
              <Wallet className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Total liquidado</p>
              <p className="text-lg font-bold">
                {formatCurrency(stats.totalPending + stats.totalPaid, stats.currency)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {(["all", "pending", "paid"] as Filter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-4 h-9 rounded-full text-xs font-bold border transition-colors",
              filter === f
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background hover:bg-muted/50 border-border",
            )}
          >
            {f === "all" ? "Todos" : f === "pending" ? "Pendientes" : "Pagados"}
          </button>
        ))}
        <Button variant="ghost" size="sm" onClick={load} className="gap-2 ml-auto">
          <RefreshCw className="h-3.5 w-3.5" /> Refrescar
        </Button>
      </div>

      {loading && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Cargando…
          </CardContent>
        </Card>
      )}
      {error && (
        <Card>
          <CardContent className="p-6 flex items-start gap-3 bg-rose-50 dark:bg-rose-950/30 border-rose-200">
            <AlertCircle className="h-5 w-5 text-rose-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-rose-800 dark:text-rose-200 text-sm">No pudimos cargar los pagos</p>
              <p className="text-rose-700 dark:text-rose-300 text-xs mt-1">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}
      {!loading && !error && filtered.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <Wallet className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
            <p className="font-semibold mb-1">Sin cortes registrados</p>
            <p className="text-sm text-muted-foreground">
              {isAdmin
                ? 'Generá tu primer corte con el botón "Generar corte" arriba.'
                : "Cuando el admin registre un pago aparecerá acá."}
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map(p => (
            <PayoutRow
              key={p.id}
              payout={p}
              canMarkPaid={isAdmin && p.status === "pending"}
              onMarkPaid={() => setMarkingPaid(p)}
            />
          ))}
        </div>
      )}

      {showWizard && (
        <GenerateWizard
          onClose={() => setShowWizard(false)}
          onCreated={() => {
            setShowWizard(false);
            load();
          }}
        />
      )}
      {markingPaid && (
        <MarkPaidDialog
          payout={markingPaid}
          onClose={() => setMarkingPaid(null)}
          onDone={() => {
            setMarkingPaid(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function PayoutRow({
  payout,
  canMarkPaid,
  onMarkPaid,
}: {
  payout: Payout;
  canMarkPaid: boolean;
  onMarkPaid: () => void;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-4">
        <StatusBadge status={payout.status} />
        <div className="min-w-0 flex-1">
          <p className="font-bold truncate">{payout.memberName}</p>
          <p className="text-xs text-muted-foreground truncate">
            {formatPeriod(payout.periodStart, payout.periodEnd)}
            {payout.paidAt && (
              <>
                {" · "}Pagado el {new Date(payout.paidAt).toLocaleDateString("es")}
                {payout.paymentMethod && ` (${methodLabel(payout.paymentMethod)})`}
                {payout.reference && ` · ref ${payout.reference}`}
              </>
            )}
          </p>
        </div>
        <div className="text-right">
          <p className="font-bold">{formatCurrency(payout.totalAmount, payout.currency)}</p>
          {canMarkPaid && (
            <Button size="sm" onClick={onMarkPaid} className="mt-1 h-7 text-xs">
              Marcar pagado
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "paid") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100 gap-1">
        <CheckCircle2 className="h-3 w-3" /> Pagado
      </Badge>
    );
  }
  if (status === "cancelled") {
    return (
      <Badge variant="outline" className="text-muted-foreground gap-1">
        <X className="h-3 w-3" /> Cancelado
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">
      Pendiente
    </Badge>
  );
}

function methodLabel(m: string): string {
  return m === "cash"
    ? "Efectivo"
    : m === "transfer"
      ? "Transferencia"
      : m === "paypal"
        ? "PayPal"
        : "Otro";
}

function formatPeriod(start: string, end: string): string {
  const s = new Date(start + "T00:00:00").toLocaleDateString("es", { day: "2-digit", month: "short" });
  const e = new Date(end + "T00:00:00").toLocaleDateString("es", { day: "2-digit", month: "short" });
  return `${s} – ${e}`;
}

// ── Wizard "Generar corte" ────────────────────────────────────────────────────

function GenerateWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  // Default: lunes pasado al domingo de esta semana (corte semanal canónico).
  const defaultStart = mondayOf(addDays(todayIso(), -7));
  const defaultEnd = addDays(defaultStart, 6);

  const [periodStart, setPeriodStart] = useState(defaultStart);
  const [periodEnd, setPeriodEnd] = useState(defaultEnd);
  const [preview, setPreview] = useState<PreviewBucket[] | null>(null);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [previewCurrency, setPreviewCurrency] = useState("DOP");
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const runPreview = async () => {
    setLoadingPreview(true);
    setErr(null);
    setPreview(null);
    try {
      const r = await fetch("/api/payouts/preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodStart, periodEnd }),
      });
      if (!r.ok) {
        const msg = (await r.json().catch(() => ({}))).error || `Error ${r.status}`;
        throw new Error(msg);
      }
      const d = (await r.json()) as {
        buckets: PreviewBucket[];
        totalAmount: number;
        currency: string;
      };
      setPreview(d.buckets);
      setPreviewTotal(d.totalAmount);
      setPreviewCurrency(d.currency);
      setExcluded(new Set());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error en preview");
    } finally {
      setLoadingPreview(false);
    }
  };

  const submit = async () => {
    if (!preview) return;
    setSubmitting(true);
    setErr(null);
    try {
      const buckets = preview
        .filter(b => !excluded.has(b.memberId))
        .map(b => ({
          memberId: b.memberId,
          currency: b.currency,
          items: b.items.map(i => ({ taskId: i.taskId, amount: i.amount })),
        }));
      if (buckets.length === 0) {
        setErr("Excluiste todos los miembros — no hay nada para liquidar.");
        setSubmitting(false);
        return;
      }
      const r = await fetch("/api/payouts/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodStart, periodEnd, buckets }),
      });
      if (!r.ok) {
        const msg = (await r.json().catch(() => ({}))).error || `Error ${r.status}`;
        throw new Error(msg);
      }
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al generar");
    } finally {
      setSubmitting(false);
    }
  };

  const adjustedTotal = useMemo(() => {
    if (!preview) return 0;
    return preview
      .filter(b => !excluded.has(b.memberId))
      .reduce((s, b) => s + b.total, 0);
  }, [preview, excluded]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold">Generar corte</h3>
            <p className="text-xs text-muted-foreground">
              Liquidá tareas validadas en un periodo.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">Desde</Label>
              <Input
                type="date"
                value={periodStart}
                onChange={e => setPeriodStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Hasta</Label>
              <Input
                type="date"
                value={periodEnd}
                onChange={e => setPeriodEnd(e.target.value)}
              />
            </div>
            <Button
              onClick={runPreview}
              disabled={loadingPreview}
              className="gap-2"
            >
              <CalendarIcon className="h-4 w-4" />
              {loadingPreview ? "Calculando…" : "Calcular preview"}
            </Button>
          </div>

          {err && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/30 p-3 text-sm text-rose-700 dark:text-rose-300 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5" />
              <span>{err}</span>
            </div>
          )}

          {preview && preview.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Sin tareas elegibles en ese rango. Probá ampliar el periodo o
              verificá que las tareas estén validadas.
            </div>
          )}

          {preview && preview.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">
                  {preview.length} miembro{preview.length === 1 ? "" : "s"} con tareas elegibles
                </span>
                <span className="font-bold text-primary">
                  Total ajustado: {formatCurrency(adjustedTotal, previewCurrency)}
                </span>
              </div>
              <div className="space-y-2">
                {preview.map(b => {
                  const isExcluded = excluded.has(b.memberId);
                  return (
                    <BucketCard
                      key={b.memberId}
                      bucket={b}
                      excluded={isExcluded}
                      onToggle={() => {
                        setExcluded(prev => {
                          const next = new Set(prev);
                          if (next.has(b.memberId)) next.delete(b.memberId);
                          else next.add(b.memberId);
                          return next;
                        });
                      }}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t flex items-center justify-between gap-3 bg-muted/10">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            disabled={!preview || preview.length === 0 || submitting || adjustedTotal <= 0}
            className="gradient-gold text-primary-foreground gap-2"
          >
            {submitting ? "Generando…" : `Confirmar ${formatCurrency(adjustedTotal, previewCurrency)}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function BucketCard({
  bucket,
  excluded,
  onToggle,
}: {
  bucket: PreviewBucket;
  excluded: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className={cn(
        "rounded-xl border p-3 transition-colors",
        excluded ? "border-dashed opacity-50" : "border-border",
      )}
    >
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={!excluded}
          onChange={onToggle}
          className="w-5 h-5 accent-primary"
        />
        <div className="min-w-0 flex-1">
          <p className="font-bold text-sm truncate">{bucket.memberName}</p>
          <p className="text-[11px] text-muted-foreground">
            {bucket.itemCount} tarea{bucket.itemCount === 1 ? "" : "s"} · {bucket.memberRole}
          </p>
        </div>
        <p className="font-bold text-sm">{formatCurrency(bucket.total, bucket.currency)}</p>
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-muted-foreground hover:text-foreground p-1"
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
        </button>
      </div>
      {expanded && (
        <ul className="mt-3 ml-7 space-y-1 text-xs">
          {bucket.items.map(i => (
            <li key={i.taskId} className="flex justify-between gap-2 text-muted-foreground">
              <span className="truncate">
                {new Date(i.dueDate + "T00:00:00").toLocaleDateString("es", { day: "2-digit", month: "short" })} · {i.propertyName}
              </span>
              <span className="font-semibold text-foreground">
                {formatCurrency(i.amount, bucket.currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Marcar pagado ─────────────────────────────────────────────────────────────

function MarkPaidDialog({
  payout,
  onClose,
  onDone,
}: {
  payout: Payout;
  onClose: () => void;
  onDone: () => void;
}) {
  const [method, setMethod] = useState<"cash" | "transfer" | "paypal" | "other">(
    "transfer",
  );
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      const r = await fetch(`/api/payouts/${payout.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "paid",
          paymentMethod: method,
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      if (!r.ok) {
        const msg = (await r.json().catch(() => ({}))).error || `Error ${r.status}`;
        throw new Error(msg);
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-md">
        <div className="p-6 border-b">
          <h3 className="text-lg font-bold">Registrar pago</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {payout.memberName} · {formatCurrency(payout.totalAmount, payout.currency)}
          </p>
        </div>

        <div className="p-6 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Método de pago</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["transfer", "cash", "paypal", "other"] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMethod(m)}
                  className={cn(
                    "h-10 rounded-md border text-xs font-semibold transition-colors",
                    method === m
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:bg-muted/30",
                  )}
                >
                  {methodLabel(m)}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Referencia (opcional)</Label>
            <Input
              value={reference}
              onChange={e => setReference(e.target.value)}
              placeholder="Nº transferencia, voucher, etc."
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notas (opcional)</Label>
            <Input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Cualquier comentario"
            />
          </div>
          {err && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 dark:bg-rose-950/30 p-3 text-sm text-rose-700 dark:text-rose-300 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5" />
              <span>{err}</span>
            </div>
          )}
        </div>

        <div className="p-6 border-t flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={submit}
            disabled={submitting}
            className="gap-2 gradient-gold text-primary-foreground"
          >
            <CheckCircle2 className="h-4 w-4" />
            {submitting ? "Guardando…" : "Confirmar pago"}
          </Button>
        </div>
      </div>
    </div>
  );
}
