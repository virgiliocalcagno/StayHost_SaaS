"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Users, Save, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { formatMoney } from "@/lib/money/format";

interface Member {
  id: string;
  name: string;
  avatar?: string;
}

interface Props {
  propertyId: string | null;            // null = propiedad nueva, todavía sin id en BD
  cleaners: Member[];
  supervisors: Member[];
  defaultCleanerPayout: number | null;  // del form, en string→number
  defaultSupervisorPayout: number | null;
  currency: string;
}

interface OverrideMap {
  // key = `${memberId}:${role}` → amount o "" si vacío.
  [key: string]: string;
}

const k = (memberId: string, role: "cleaner" | "supervisor") => `${memberId}:${role}`;

export default function PricingOverridesEditor({
  propertyId,
  cleaners,
  supervisors,
  defaultCleanerPayout,
  defaultSupervisorPayout,
  currency,
}: Props) {
  const [loaded, setLoaded] = useState<OverrideMap>({});
  const [draft, setDraft] = useState<OverrideMap>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    if (!propertyId) {
      setLoaded({});
      setDraft({});
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/pricing-overrides`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        overrides: { memberId: string; role: "cleaner" | "supervisor"; amount: number }[];
      };
      const map: OverrideMap = {};
      for (const o of data.overrides) {
        map[k(o.memberId, o.role)] = String(o.amount);
      }
      setLoaded(map);
      setDraft(map);
    } catch {
      toast.error("No pudimos cargar los overrides de tarifa");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  const dirty = useMemo(() => {
    const keys = new Set([...Object.keys(loaded), ...Object.keys(draft)]);
    for (const key of keys) {
      const a = (loaded[key] ?? "").trim();
      const b = (draft[key] ?? "").trim();
      if (a !== b) return true;
    }
    return false;
  }, [loaded, draft]);

  const handleChange = (memberId: string, role: "cleaner" | "supervisor", value: string) => {
    setDraft(prev => ({ ...prev, [k(memberId, role)]: value }));
  };

  const handleSave = async () => {
    if (!propertyId) {
      toast.error("Guardá la propiedad primero antes de fijar overrides");
      return;
    }
    setSaving(true);
    try {
      // Construir patch: comparar draft vs loaded.
      const patches: { memberId: string; role: "cleaner" | "supervisor"; amount: number | null }[] = [];
      const allKeys = new Set([...Object.keys(loaded), ...Object.keys(draft)]);
      for (const key of allKeys) {
        const before = (loaded[key] ?? "").trim();
        const after = (draft[key] ?? "").trim();
        if (before === after) continue;
        const [memberId, role] = key.split(":") as [string, "cleaner" | "supervisor"];
        if (after === "") {
          patches.push({ memberId, role, amount: null });
        } else {
          const num = Number(after);
          if (!Number.isFinite(num) || num < 0) {
            toast.error(`Monto inválido para uno de los miembros`);
            setSaving(false);
            return;
          }
          patches.push({ memberId, role, amount: num });
        }
      }
      if (patches.length === 0) {
        setSaving(false);
        return;
      }
      const res = await fetch(`/api/properties/${propertyId}/pricing-overrides`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ overrides: patches }),
      });
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      toast.success("Tarifas por miembro guardadas");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  if (!propertyId) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
        Guardá la propiedad para poder fijar overrides por miembro. Sin ID todavía no podemos persistir overrides.
      </div>
    );
  }

  if (cleaners.length === 0 && supervisors.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
        No hay miembros del equipo todavía. Creá cleaners/supervisores en el panel de Equipo y volvé acá para fijar tarifas individuales.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Users className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="text-xs text-slate-700 leading-snug">
            <span className="font-bold">Tarifas por miembro (override).</span> Si un cleaner cobra distinto en esta propiedad, fijá el monto acá. Sin override → se hereda el default de la propiedad.
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void reload()}
          disabled={loading}
          className="h-7 px-2 text-[11px]"
        >
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} />
          Recargar
        </Button>
      </div>

      <div className="rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left px-3 py-2 font-bold">Miembro</th>
              <th className="text-right px-3 py-2 font-bold">
                Cobro como cleaner
                <div className="text-[10px] font-normal text-slate-400 normal-case">
                  default {defaultCleanerPayout != null ? formatMoney(defaultCleanerPayout, currency) : "—"}
                </div>
              </th>
              <th className="text-right px-3 py-2 font-bold">
                Cobro como supervisor
                <div className="text-[10px] font-normal text-slate-400 normal-case">
                  default {defaultSupervisorPayout != null ? formatMoney(defaultSupervisorPayout, currency) : "—"}
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[
              ...cleaners.map(m => ({ ...m, role: "cleaner" as const })),
              ...supervisors.map(m => ({ ...m, role: "supervisor" as const })),
            ]
              // dedupe (un supervisor que también limpia aparece en ambas)
              .reduce<{ id: string; name: string; avatar?: string; isCleaner: boolean; isSupervisor: boolean }[]>(
                (acc, cur) => {
                  const ex = acc.find(x => x.id === cur.id);
                  if (ex) {
                    if (cur.role === "cleaner") ex.isCleaner = true;
                    else ex.isSupervisor = true;
                  } else {
                    acc.push({
                      id: cur.id,
                      name: cur.name,
                      avatar: cur.avatar,
                      isCleaner: cur.role === "cleaner",
                      isSupervisor: cur.role === "supervisor",
                    });
                  }
                  return acc;
                },
                [],
              )
              // un supervisor también puede limpiar — siempre permitir override de cleaner
              .map(m => {
                m.isCleaner = true;
                return m;
              })
              .map(m => (
                <tr key={m.id}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-7 w-7">
                        {m.avatar && <AvatarImage src={m.avatar} alt={m.name} />}
                        <AvatarFallback className="text-[10px]">
                          {m.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800 truncate">{m.name}</p>
                        {m.isSupervisor && (
                          <Badge variant="outline" className="text-[9px] border-amber-200 bg-amber-50 text-amber-700 mt-0.5">
                            supervisor
                          </Badge>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      type="number"
                      inputMode="decimal"
                      placeholder={defaultCleanerPayout != null ? String(defaultCleanerPayout) : "—"}
                      className="h-9 w-28 ml-auto text-right"
                      value={draft[k(m.id, "cleaner")] ?? ""}
                      onChange={e => handleChange(m.id, "cleaner", e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {m.isSupervisor ? (
                      <Input
                        type="number"
                        inputMode="decimal"
                        placeholder={defaultSupervisorPayout != null ? String(defaultSupervisorPayout) : "—"}
                        className="h-9 w-28 ml-auto text-right"
                        value={draft[k(m.id, "supervisor")] ?? ""}
                        onChange={e => handleChange(m.id, "supervisor", e.target.value)}
                      />
                    ) : (
                      <span className="text-[11px] text-slate-300">no aplica</span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Label className="text-[11px] text-slate-400">
          Vacío = usa el default de la propiedad.
        </Label>
        <Button
          size="sm"
          disabled={!dirty || saving}
          onClick={() => void handleSave()}
          className="h-8"
        >
          <Save className="h-3 w-3 mr-1.5" />
          {saving ? "Guardando…" : dirty ? "Guardar overrides" : "Sin cambios"}
        </Button>
      </div>
    </div>
  );
}
