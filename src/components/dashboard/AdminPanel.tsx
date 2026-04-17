"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users, Building2, TrendingUp, Zap, ShieldCheck, Search, Activity,
  LifeBuoy, Clock, MessageSquare, ChevronDown, CheckCircle2, XCircle,
  AlertTriangle, BarChart2, DollarSign, Package, Puzzle, Eye,
  ToggleLeft, ToggleRight, Plus, Trash2, Crown, Rocket, Star,
  RefreshCw, ArrowUpRight, Layers, Cpu, Send,
} from "lucide-react";
import {
  useModules, SAAS_PLANS, PLAN_PRICES, BUILTIN_PLUGINS, type PluginManifest,
} from "@/context/ModuleContext";

// ─── Types ────────────────────────────────────────────────────────────────────

type Plan = "Trial" | "Starter" | "Growth" | "Master";
type TenantStatus = "active" | "trial" | "suspended" | "churned";

interface Tenant {
  id: string; name: string; email: string; company?: string;
  plan: Plan; mrr: number; properties: number;
  status: TenantStatus; lastLogin: string;
}

// ─── Static mock data ─────────────────────────────────────────────────────────

const MOCK_TENANTS: Tenant[] = [
  { id:"t1", name:"Carlos Medina",    email:"carlos@villamar.com",   company:"Villa Mar Group", plan:"Master",  mrr:179, properties:12, status:"active",    lastLogin:"Hace 2h"    },
  { id:"t2", name:"María Sánchez",    email:"maria@luxuryrd.com",    company:"Luxury RD",        plan:"Growth",  mrr:79,  properties:4,  status:"active",    lastLogin:"Hace 1d"    },
  { id:"t3", name:"Pedro González",   email:"pedro@casamar.com",     company:"Casa Mar",         plan:"Starter", mrr:29,  properties:2,  status:"active",    lastLogin:"Hace 3d"    },
  { id:"t4", name:"Ana Rodríguez",    email:"ana@rentals.com",       company:undefined,          plan:"Trial",   mrr:0,   properties:1,  status:"trial",     lastLogin:"Hace 5h"    },
  { id:"t5", name:"Roberto Ferreira", email:"roberto@paradise.com",  company:"Paradise Stays",   plan:"Master",  mrr:179, properties:23, status:"active",    lastLogin:"Hace 30min" },
  { id:"t6", name:"Luisa Torres",     email:"luisa@colonial.com",    company:"Colonial Suites",  plan:"Growth",  mrr:79,  properties:6,  status:"active",    lastLogin:"Hace 2d"    },
  { id:"t7", name:"Miguel Castro",    email:"miguel@beachfront.com", company:undefined,          plan:"Starter", mrr:29,  properties:1,  status:"suspended", lastLogin:"Hace 14d"   },
];

const MRR_TREND = [
  { month:"Sep", value:8400  }, { month:"Oct", value:11200 }, { month:"Nov", value:13900 },
  { month:"Dic", value:15200 }, { month:"Ene", value:17800 }, { month:"Feb", value:19400 },
  { month:"Mar", value:21200 }, { month:"Abr", value:24500 },
];

const TICKETS = [
  { id:"T-108", tenant:"María Sánchez",    topic:"Error en sincronización iCal con Airbnb",  priority:"high",   status:"open",   time:"hace 12 min" },
  { id:"T-107", tenant:"Pedro González",   topic:"Cómo configurar cerradura TTLock",         priority:"medium", status:"open",   time:"hace 1h"     },
  { id:"T-106", tenant:"Ana Rodríguez",    topic:"No recibo emails de confirmación",          priority:"high",   status:"open",   time:"hace 3h"     },
  { id:"T-105", tenant:"Roberto Ferreira", topic:"Solicitud de factura anual",                priority:"low",    status:"closed", time:"hace 1d"     },
  { id:"T-104", tenant:"Carlos Medina",    topic:"Sugerencia: exportar reportes en Excel",    priority:"low",    status:"closed", time:"hace 2d"     },
];

// ─── Style maps ───────────────────────────────────────────────────────────────

const PLAN_COLORS: Record<Plan, string> = {
  Trial:"bg-slate-100 text-slate-600", Starter:"bg-blue-100 text-blue-700",
  Growth:"bg-violet-100 text-violet-700", Master:"bg-amber-100 text-amber-700",
};
const STATUS_CFG: Record<TenantStatus, { label:string; color:string }> = {
  active:    { label:"Activo",     color:"bg-emerald-100 text-emerald-700" },
  trial:     { label:"Trial",      color:"bg-sky-100 text-sky-700" },
  suspended: { label:"Suspendido", color:"bg-red-100 text-red-700" },
  churned:   { label:"Perdido",    color:"bg-slate-100 text-slate-500" },
};
const CATEGORY_LABELS: Record<string, string> = {
  operations:"Operaciones", revenue:"Ingresos", integrations:"Integraciones",
  ai:"IA", compliance:"Cumplimiento",
};
const TIER_COLORS: Record<string, string> = {
  starter:"bg-blue-100 text-blue-700",  growth:"bg-violet-100 text-violet-700",
  master:"bg-amber-100 text-amber-700", addon:"bg-emerald-100 text-emerald-700",
};

// ─── MRR Sparkline (SVG, zero dependencies) ───────────────────────────────────

function MRRSparkline() {
  const W=400; const H=80; const PAD=8;
  const vals = MRR_TREND.map(d => d.value);
  const min = Math.min(...vals); const max = Math.max(...vals);
  const sy = (v:number) => PAD + (H-PAD*2) - ((v-min)/(max-min))*(H-PAD*2);
  const sx = (i:number) => PAD + (i/(vals.length-1))*(W-PAD*2);
  const pts = vals.map((v,i) => `${sx(i)},${sy(v)}`).join(" ");
  const area = `${sx(0)},${H} ${pts} ${sx(vals.length-1)},${H}`;
  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20" preserveAspectRatio="none">
        <defs>
          <linearGradient id="mrrGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.3"/>
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0"/>
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#mrrGrad)"/>
        <polyline points={pts} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
        {vals.map((v,i) => <circle key={i} cx={sx(i)} cy={sy(v)} r="3.5" fill="#f59e0b"/>)}
      </svg>
      <div className="flex justify-between px-2 -mt-1">
        {MRR_TREND.map(d => <span key={d.month} className="text-[10px] text-slate-400 font-medium">{d.month}</span>)}
      </div>
    </div>
  );
}

// ─── Plan Preview Card ────────────────────────────────────────────────────────

function PlanCard({ planId, onApply, isPreview }: {
  planId:"starter"|"growth"|"master"; onApply:()=>void; isPreview:boolean;
}) {
  const meta: Record<string, { icon:React.ElementType; color:string; border:string }> = {
    starter: { icon:Star,   color:"text-blue-600",   border:"border-blue-200"   },
    growth:  { icon:Rocket, color:"text-violet-600", border:"border-violet-200" },
    master:  { icon:Crown,  color:"text-amber-600",  border:"border-amber-300"  },
  };
  const { icon:Icon, color, border } = meta[planId];
  const includedIds = SAAS_PLANS[planId];
  return (
    <Card className={`border-2 ${border} ${isPreview ? "ring-2 ring-offset-1 ring-amber-400" : ""} transition-all`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className={`h-5 w-5 ${color}`}/><CardTitle className="text-base capitalize">{planId}</CardTitle>
          </div>
          <div className="text-right">
            <p className="text-2xl font-black">${PLAN_PRICES[planId]}</p>
            <p className="text-xs text-slate-400">/mes</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1 mb-3">
          {BUILTIN_PLUGINS.map(p => {
            const inc = includedIds.includes(p.id as never);
            return (
              <div key={p.id} className={`flex items-center gap-2 text-xs py-1 px-2 rounded-lg ${inc ? "bg-muted/50" : "opacity-35"}`}>
                {inc
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0"/>
                  : <XCircle className="h-3.5 w-3.5 text-slate-300 shrink-0"/>
                }
                <span className={inc ? "font-medium" : ""}>{p.name}</span>
              </div>
            );
          })}
        </div>
        <Button size="sm" variant={isPreview ? "default" : "outline"}
          className={`w-full ${isPreview ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}`}
          onClick={onApply}>
          <Eye className="h-3.5 w-3.5 mr-1.5"/>
          {isPreview ? "Previsualización activa" : "Previsualizar este plan"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Plugin Row ───────────────────────────────────────────────────────────────

function PluginRow({ plugin, enabled, onToggle, onDelete }: {
  plugin:PluginManifest; enabled:boolean; onToggle:()=>void; onDelete?:()=>void;
}) {
  return (
    <div className={`flex items-center gap-4 p-3 rounded-xl border transition-all ${enabled ? "bg-card" : "bg-muted/30 opacity-60"}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold truncate">{plugin.name}</p>
          <Badge className={`text-[10px] px-2 py-0 border-none ${TIER_COLORS[plugin.planTier]}`}>{plugin.planTier}</Badge>
          <Badge variant="outline" className="text-[10px] px-2 py-0 text-muted-foreground">
            {CATEGORY_LABELS[plugin.category] ?? plugin.category}
          </Badge>
          {!plugin.builtIn && <Badge className="text-[10px] px-2 py-0 bg-purple-100 text-purple-700 border-none">Plugin</Badge>}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{plugin.description}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] text-muted-foreground font-mono">v{plugin.version}</span>
        <button type="button" onClick={onToggle} aria-label={enabled ? "Desactivar" : "Activar"}>
          {enabled
            ? <ToggleRight className="h-7 w-7 text-emerald-500"/>
            : <ToggleLeft className="h-7 w-7 text-slate-300"/>
          }
        </button>
        {onDelete && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground hover:text-destructive"
            onClick={onDelete} aria-label="Eliminar plugin">
            <Trash2 className="h-3.5 w-3.5"/>
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminPanel() {
  const {
    modules: _modules, toggleModule, isModuleEnabled, applyPlan,
    plugins, registerPlugin, unregisterPlugin, togglePlugin,
    previewPlan, setPreviewPlan,
  } = useModules();

  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState<Plan | "all">("all");
  const [tenantMenuOpen, setTenantMenuOpen] = useState<string | null>(null);
  const [showPluginForm, setShowPluginForm] = useState(false);
  const [pluginForm, setPluginForm] = useState<Partial<PluginManifest>>({
    planTier:"addon", category:"integrations", version:"1.0", enabled:true, builtIn:false,
  });

  // ── Metrics ────────────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const active = MOCK_TENANTS.filter(t => t.status === "active");
    const mrr = active.reduce((s,t) => s + t.mrr, 0);
    const avgMrr = active.length > 0 ? Math.round(mrr / active.length) : 0;
    const prevMrr = MRR_TREND[MRR_TREND.length - 2].value;
    const mrrGrowth = (((mrr) - prevMrr) / prevMrr * 100).toFixed(1);
    return {
      mrr, arr: mrr * 12, active: active.length,
      trial: MOCK_TENANTS.filter(t => t.status === "trial").length,
      totalProps: MOCK_TENANTS.reduce((s,t) => s + t.properties, 0),
      avgMrr, mrrGrowth,
    };
  }, []);

  const filtered = useMemo(() => MOCK_TENANTS.filter(t => {
    const ms = !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.email.toLowerCase().includes(search.toLowerCase());
    const mp = planFilter === "all" || t.plan === planFilter;
    return ms && mp;
  }), [search, planFilter]);

  const allPlugins: PluginManifest[] = useMemo(() =>
    [...BUILTIN_PLUGINS.map(p => ({ ...p, enabled: isModuleEnabled(p.id) })), ...plugins],
  [plugins, isModuleEnabled]);

  const openTickets = TICKETS.filter(t => t.status === "open").length;

  function handleRegisterPlugin() {
    if (!pluginForm.id || !pluginForm.name || !pluginForm.description) return;
    registerPlugin({
      id: pluginForm.id, name: pluginForm.name, description: pluginForm.description,
      version: pluginForm.version ?? "1.0",
      category: pluginForm.category as PluginManifest["category"],
      planTier: pluginForm.planTier as PluginManifest["planTier"],
      addonPrice: pluginForm.addonPrice, enabled: true, builtIn: false,
    });
    setPluginForm({ planTier:"addon", category:"integrations", version:"1.0", enabled:true, builtIn:false });
    setShowPluginForm(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-amber-500/10">
              <Zap className="h-6 w-6 text-amber-500 fill-amber-400"/>
            </div>
            <h2 className="text-2xl font-black tracking-tight">SaaS Intelligence Center</h2>
          </div>
          <p className="text-muted-foreground text-sm mt-1 ml-1">
            Control total del ecosistema StayHost — métricas, tenants, módulos y soporte.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {previewPlan && (
            <Badge className="bg-amber-500/20 text-amber-700 border border-amber-300 gap-1.5 px-3 py-1">
              <Eye className="h-3 w-3"/>Previsualizando: {previewPlan}
              <button type="button" onClick={() => setPreviewPlan(null)} className="ml-1 hover:text-red-600" aria-label="Salir de preview">×</button>
            </Badge>
          )}
          <Button variant="outline" size="sm" className="gap-2">
            <RefreshCw className="h-4 w-4"/>Actualizar
          </Button>
        </div>
      </div>

      <Tabs defaultValue="metrics">
        <TabsList className="grid w-full grid-cols-4 h-11">
          <TabsTrigger value="metrics"  className="gap-1.5 text-xs sm:text-sm"><BarChart2 className="h-4 w-4"/>Métricas</TabsTrigger>
          <TabsTrigger value="tenants"  className="gap-1.5 text-xs sm:text-sm"><Users className="h-4 w-4"/>Clientes</TabsTrigger>
          <TabsTrigger value="modules"  className="gap-1.5 text-xs sm:text-sm"><Puzzle className="h-4 w-4"/>Módulos</TabsTrigger>
          <TabsTrigger value="support"  className="gap-1.5 text-xs sm:text-sm relative">
            <LifeBuoy className="h-4 w-4"/>Soporte
            {openTickets > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-black text-white">
                {openTickets}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ════════════════════ TAB: MÉTRICAS ═════════════════════════════ */}
        <TabsContent value="metrics" className="mt-6 space-y-6">

          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {([
              { label:"MRR",           value:`$${metrics.mrr.toLocaleString()}`, sub:`ARR $${(metrics.arr/1000).toFixed(0)}k`,              trend:`+${metrics.mrrGrowth}%`, icon:DollarSign, color:"text-emerald-600", bg:"bg-emerald-50" },
              { label:"Clientes",      value:metrics.active,                      sub:`${metrics.trial} en trial`,                            trend:"+2 este mes",           icon:Users,      color:"text-blue-600",   bg:"bg-blue-50"   },
              { label:"Propiedades",   value:metrics.totalProps,                  sub:`~${Math.round(metrics.totalProps/Math.max(metrics.active,1))} / cliente`, trend:"+8%", icon:Building2,  color:"text-violet-600", bg:"bg-violet-50" },
              { label:"ARPU",          value:`$${metrics.avgMrr}`,                sub:"Ingreso medio / cliente",                              trend:"+$12",                  icon:TrendingUp, color:"text-amber-600",  bg:"bg-amber-50"  },
            ] as const).map(kpi => (
              <Card key={kpi.label}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className={`p-2.5 rounded-xl ${kpi.bg}`}><kpi.icon className={`h-5 w-5 ${kpi.color}`}/></div>
                    <span className="text-xs font-bold flex items-center gap-0.5 text-emerald-600">
                      <ArrowUpRight className="h-3 w-3"/>{kpi.trend}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{kpi.label}</p>
                  <p className="text-2xl font-black mt-0.5">{kpi.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{kpi.sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* MRR Chart */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Evolución MRR</CardTitle>
                  <Badge className="bg-emerald-100 text-emerald-700 border-none font-bold">
                    +{metrics.mrrGrowth}% vs mes anterior
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex justify-between text-xs text-muted-foreground mb-2 px-1">
                  <span>$8.4k</span><span className="font-bold text-amber-600">$24.5k</span>
                </div>
                <MRRSparkline/>
              </CardContent>
            </Card>

            {/* Plan distribution */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Distribución de Planes</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {(["Master","Growth","Starter","Trial"] as Plan[]).map(plan => {
                  const count = MOCK_TENANTS.filter(t => t.plan === plan).length;
                  const pct = Math.round((count / MOCK_TENANTS.length) * 100);
                  const bar: Record<Plan,string> = { Master:"bg-amber-500", Growth:"bg-violet-500", Starter:"bg-blue-500", Trial:"bg-slate-300" };
                  return (
                    <div key={plan}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-medium">{plan}</span>
                        <span className="text-muted-foreground">{count} · {pct}%</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full ${bar[plan]} rounded-full`} style={{width:`${pct}%`}}/>
                      </div>
                    </div>
                  );
                })}
                <div className="pt-3 border-t space-y-1.5">
                  {([
                    ["Churn rate (30d)", "2.1%",  "text-red-500"],
                    ["Trial → Paid",     "34%",   "text-emerald-600"],
                    ["LTV estimado",     "$2,180", ""],
                  ] as const).map(([l,v,c]) => (
                    <div key={l} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{l}</span>
                      <span className={`font-bold ${c}`}>{v}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* System health */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-emerald-500"/>Estado del Sistema
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {([["API Gateway","18ms"],["Sincronizador iCal","210ms"],["Stripe Gateway","94ms"],["Base de Datos","12ms"]] as const).map(([n,l]) => (
                  <div key={n} className="flex items-center justify-between p-3 bg-muted/40 rounded-xl">
                    <div>
                      <p className="text-xs font-semibold">{n}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{l}</p>
                    </div>
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"/>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ════════════════════ TAB: CLIENTES ═════════════════════════════ */}
        <TabsContent value="tenants" className="mt-6 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre o email..." className="pl-9"/>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {(["all","Trial","Starter","Growth","Master"] as const).map(p => (
                <button type="button" key={p} onClick={() => setPlanFilter(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${planFilter === p ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                  {p === "all" ? "Todos" : p}
                </button>
              ))}
            </div>
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/40 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="px-5 py-4">Cliente</th>
                    <th className="px-4 py-4 text-center">Props.</th>
                    <th className="px-4 py-4">Plan</th>
                    <th className="px-4 py-4 text-right">MRR</th>
                    <th className="px-4 py-4">Estado</th>
                    <th className="px-4 py-4">Login</th>
                    <th className="px-4 py-4 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map(t => (
                    <tr key={t.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center font-black text-primary text-sm shrink-0">
                            {t.name[0]}
                          </div>
                          <div>
                            <p className="font-semibold leading-none">{t.name}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{t.email}</p>
                            {t.company && <p className="text-[10px] text-muted-foreground/60">{t.company}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center font-bold">{t.properties}</td>
                      <td className="px-4 py-4">
                        <Badge className={`${PLAN_COLORS[t.plan]} border-none font-semibold`}>{t.plan}</Badge>
                      </td>
                      <td className="px-4 py-4 text-right font-bold">
                        {t.mrr > 0 ? `$${t.mrr}` : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-4">
                        <Badge className={`${STATUS_CFG[t.status].color} border-none text-xs`}>
                          {STATUS_CFG[t.status].label}
                        </Badge>
                      </td>
                      <td className="px-4 py-4 text-xs text-muted-foreground">{t.lastLogin}</td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1 justify-end">
                          <div className="relative">
                            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs gap-1"
                              onClick={() => setTenantMenuOpen(tenantMenuOpen === t.id ? null : t.id)}>
                              <Package className="h-3.5 w-3.5"/>Plan<ChevronDown className="h-3 w-3"/>
                            </Button>
                            {tenantMenuOpen === t.id && (
                              <div className="absolute right-0 top-9 z-20 bg-card border rounded-xl shadow-xl p-1 w-36 space-y-0.5">
                                {(["starter","growth","master"] as const).map(p => (
                                  <button type="button" key={p} className="w-full text-left text-xs px-3 py-2 rounded-lg hover:bg-muted capitalize font-medium"
                                    onClick={() => { applyPlan(p); setTenantMenuOpen(null); }}>
                                    Cambiar a {p.charAt(0).toUpperCase()+p.slice(1)}
                                  </button>
                                ))}
                                <div className="border-t my-1"/>
                                <button type="button" className="w-full text-left text-xs px-3 py-2 rounded-lg hover:bg-red-50 text-red-600 font-medium"
                                  onClick={() => setTenantMenuOpen(null)}>
                                  Suspender
                                </button>
                              </div>
                            )}
                          </div>
                          <Button variant="outline" size="sm"
                            className="h-8 px-2 text-xs gap-1 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700">
                            <ShieldCheck className="h-3.5 w-3.5"/>Acceder
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-3 border-t bg-muted/20 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{filtered.length} de {MOCK_TENANTS.length} clientes</p>
              <Button size="sm" className="h-8 gap-1.5 gradient-gold text-primary-foreground">
                <Plus className="h-3.5 w-3.5"/>Nuevo cliente
              </Button>
            </div>
          </Card>
        </TabsContent>

        {/* ════════════════════ TAB: MÓDULOS ══════════════════════════════ */}
        <TabsContent value="modules" className="mt-6 space-y-6">

          {/* Plan builder */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold">Constructor de Planes</h3>
                <p className="text-xs text-muted-foreground">Previsualiza qué ve un cliente según su plan. No afecta tu vista de OWNER.</p>
              </div>
              {previewPlan && (
                <Button variant="outline" size="sm" onClick={() => setPreviewPlan(null)} className="gap-1.5 text-xs">
                  <XCircle className="h-3.5 w-3.5"/>Salir de preview
                </Button>
              )}
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              {(["starter","growth","master"] as const).map(p => (
                <PlanCard key={p} planId={p} isPreview={previewPlan === p}
                  onApply={() => { applyPlan(p); setPreviewPlan(previewPlan === p ? null : p); }}/>
              ))}
            </div>
          </div>

          {/* Plugin registry */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold flex items-center gap-2">
                  <Puzzle className="h-4 w-4 text-purple-500"/>Registro de Módulos
                </h3>
                <p className="text-xs text-muted-foreground">
                  {allPlugins.filter(p => isModuleEnabled(p.id)).length} de {allPlugins.length} módulos activos globalmente
                </p>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setShowPluginForm(v => !v)}>
                <Plus className="h-3.5 w-3.5"/>Registrar Plugin
              </Button>
            </div>

            {showPluginForm && (
              <Card className="mb-4 border-purple-200 bg-purple-50/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Puzzle className="h-4 w-4 text-purple-500"/>Nuevo Plugin Externo
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-xs bg-muted/50 rounded-lg p-3 space-y-1">
                    <p className="font-semibold">Guia de integracion:</p>
                    <p>1. Crea el componente en <code className="font-mono bg-muted px-1 rounded">src/components/dashboard/</code></p>
                    <p>2. Agrega un <code className="font-mono bg-muted px-1 rounded">case</code> en <code className="font-mono bg-muted px-1 rounded">dashboard/page.tsx</code></p>
                    <p className="text-purple-600 font-medium">3. El sidebar lo detecta automaticamente. Zero breaking changes.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">ID unico *</Label>
                      <Input value={pluginForm.id ?? ""}
                        onChange={e => setPluginForm(f => ({...f, id: e.target.value.toLowerCase().replace(/\s+/g,"-")}))}
                        placeholder="mi-modulo" className="h-8 text-sm font-mono"/>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Nombre *</Label>
                      <Input value={pluginForm.name ?? ""}
                        onChange={e => setPluginForm(f => ({...f, name: e.target.value}))}
                        placeholder="Mi Modulo" className="h-8 text-sm"/>
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs">Descripcion *</Label>
                      <Input value={pluginForm.description ?? ""}
                        onChange={e => setPluginForm(f => ({...f, description: e.target.value}))}
                        placeholder="Que hace este modulo..." className="h-8 text-sm"/>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Categoria</Label>
                      <select value={pluginForm.category}
                        aria-label="Categoria del plugin"
                        onChange={e => setPluginForm(f => ({...f, category: e.target.value as PluginManifest["category"]}))}
                        className="w-full h-8 border rounded-md px-2 text-sm bg-background">
                        {Object.entries(CATEGORY_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Plan minimo</Label>
                      <select value={pluginForm.planTier}
                        aria-label="Plan minimo requerido"
                        onChange={e => setPluginForm(f => ({...f, planTier: e.target.value as PluginManifest["planTier"]}))}
                        className="w-full h-8 border rounded-md px-2 text-sm bg-background">
                        <option value="starter">Starter</option>
                        <option value="growth">Growth</option>
                        <option value="master">Master</option>
                        <option value="addon">Add-on (precio separado)</option>
                      </select>
                    </div>
                    {pluginForm.planTier === "addon" && (
                      <div className="space-y-1">
                        <Label className="text-xs">Precio add-on (USD/mes)</Label>
                        <Input type="number" value={pluginForm.addonPrice ?? ""}
                          onChange={e => setPluginForm(f => ({...f, addonPrice: parseFloat(e.target.value) || undefined}))}
                          placeholder="29" className="h-8 text-sm"/>
                      </div>
                    )}
                    <div className="space-y-1">
                      <Label className="text-xs">Version</Label>
                      <Input value={pluginForm.version ?? "1.0"}
                        onChange={e => setPluginForm(f => ({...f, version: e.target.value}))}
                        placeholder="1.0" className="h-8 text-sm font-mono"/>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" onClick={handleRegisterPlugin}
                      disabled={!pluginForm.id || !pluginForm.name || !pluginForm.description}
                      className="gap-1.5">
                      <Plus className="h-3.5 w-3.5"/>Registrar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowPluginForm(false)}>Cancelar</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {Object.entries(CATEGORY_LABELS).map(([cat, catLabel]) => {
              const catPlugins = allPlugins.filter(p => p.category === cat);
              if (catPlugins.length === 0) return null;
              return (
                <div key={cat} className="mb-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5"/>{catLabel}
                  </p>
                  <div className="space-y-2">
                    {catPlugins.map(p => (
                      <PluginRow key={p.id} plugin={p} enabled={isModuleEnabled(p.id)}
                        onToggle={() => p.builtIn ? toggleModule(p.id as never) : togglePlugin(p.id)}
                        onDelete={!p.builtIn ? () => unregisterPlugin(p.id) : undefined}/>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Extensibility guide */}
          <Card className="border-dashed border-2 border-purple-200 bg-purple-50/20">
            <CardContent className="pt-5 pb-4">
              <div className="flex gap-3">
                <div className="p-2 rounded-lg bg-purple-100 shrink-0 h-fit">
                  <Cpu className="h-5 w-5 text-purple-600"/>
                </div>
                <div>
                  <p className="font-semibold text-sm">Plugin Architecture — extensible sin romper nada</p>
                  <div className="mt-2 grid sm:grid-cols-2 gap-x-6 gap-y-1">
                    {([
                      ["ModuleContext",             "Motor central. Gestiona modulos core + plugins dinamicos."],
                      ["BUILTIN_PLUGINS",           "15 modulos base, siempre disponibles, no se eliminan."],
                      ["stayhost_plugin_registry",  "localStorage con plugins externos registrados desde aqui."],
                      ["PlanTier",                  "Cada modulo tiene un tier. El sidebar filtra segun plan."],
                      ["previewPlan",               "Simula la vista de un cliente sin afectar al OWNER."],
                      ["Zero deps",                 "Nuevo plugin = nuevo archivo + 1 case. No toca nada mas."],
                    ] as const).map(([k,v]) => (
                      <div key={k} className="flex gap-2 text-xs py-0.5">
                        <code className="font-mono text-purple-600 shrink-0">{k}</code>
                        <span className="text-muted-foreground">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ════════════════════ TAB: SOPORTE ══════════════════════════════ */}
        <TabsContent value="support" className="mt-6">
          <div className="grid lg:grid-cols-4 gap-6">
            <Card className="lg:col-span-3 overflow-hidden">
              <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-amber-500"/>Bandeja de Soporte
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">{openTickets} tickets abiertos</p>
                </div>
                <Badge className={openTickets > 0 ? "bg-red-100 text-red-700 border-none" : "bg-emerald-100 text-emerald-700 border-none"}>
                  {openTickets > 0 ? `${openTickets} pendientes` : "Todo resuelto"}
                </Badge>
              </CardHeader>
              <div className="divide-y">
                {TICKETS.map(t => {
                  const isOpen = t.status === "open";
                  const bar: Record<string,string> = { high:"bg-red-500", medium:"bg-amber-500", low:"bg-slate-300" };
                  return (
                    <div key={t.id} className={`p-5 flex items-start justify-between gap-4 hover:bg-muted/20 transition-colors ${!isOpen ? "opacity-50" : ""}`}>
                      <div className="flex gap-4 flex-1 min-w-0">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-white text-sm shrink-0 ${bar[t.priority]}`}>
                          {t.tenant[0]}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-sm">{t.topic}</p>
                            <Badge variant="outline" className="text-[10px]">{t.id}</Badge>
                            {isOpen && (
                              <Badge className={`text-[10px] border-none ${t.priority==="high"?"bg-red-100 text-red-700":t.priority==="medium"?"bg-amber-100 text-amber-700":"bg-slate-100 text-slate-600"}`}>
                                {t.priority==="high"?"Alta":t.priority==="medium"?"Media":"Baja"}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">{t.tenant}</span>
                            <span>·</span><Clock className="h-3 w-3"/><span>{t.time}</span>
                          </div>
                        </div>
                      </div>
                      {isOpen && (
                        <Button size="sm" variant="outline"
                          className="shrink-0 h-8 gap-1.5 text-xs hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700">
                          <Send className="h-3 w-3"/>Responder
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            <div className="space-y-4">
              <Card className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white border-none">
                <CardContent className="pt-5 pb-5">
                  <p className="text-indigo-200 text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5"/>Tiempo de Respuesta
                  </p>
                  <p className="text-4xl font-black mt-2">14 min</p>
                  <p className="text-indigo-200 text-xs mt-2 leading-relaxed">
                    Top 5% de los SaaS de real estate en velocidad de soporte.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-4 pb-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resumen</p>
                  {([
                    ["Abiertos",      openTickets,                                        "text-red-500"     ],
                    ["Cerrados (7d)", TICKETS.filter(t=>t.status==="closed").length,      "text-emerald-600" ],
                    ["CSAT",          "4.8 estrella",                                     "text-amber-500"   ],
                  ] as const).map(([l,v,c]) => (
                    <div key={l} className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">{l}</span>
                      <span className={`font-bold text-sm ${c}`}>{v}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-4 pb-4 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Seguridad</p>
                  {([
                    ["SSL valido",    true ],
                    ["Rate limiting", true ],
                    ["2FA admin",     false],
                    ["Backup diario", true ],
                  ] as const).map(([l, ok]) => (
                    <div key={l} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{l}</span>
                      {ok
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-500"/>
                        : <AlertTriangle className="h-4 w-4 text-amber-500"/>
                      }
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
