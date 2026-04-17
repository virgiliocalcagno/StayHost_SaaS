"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Calendar,
  Zap,
  RefreshCw,
  Globe,
  Info,
  MapPin,
  BarChart3,
  Target,
  InfoIcon,
  Star,
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Sliders,
  BrainCircuit,
  Moon,
  Clock,
  Percent,
  Repeat,
  Flame,
  X,
  MousePointer2,
  Search
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Property {
  id: string;
  name: string;
  address?: string;
  basePrice?: number;
  [key: string]: unknown;
}

interface PricingRule {
  id: string;
  name: string;
  description: string;
  icon: string; // Changed from React.ElementType to string for serialization
  iconColor: string;
  enabled: boolean;
  adjustment: number;
  type: "discount" | "premium";
  condition: string;
  impact: string;
}

const ICON_MAP: Record<string, React.ElementType> = {
  Clock,
  Flame,
  Moon,
  Calendar,
  TrendingUp,
  BrainCircuit,
  Zap
};

interface Competitor {
  name: string;
  price: number;
  distance: string;
  rating: number;
  amenities: string[];
  segment: string;
  similitud: number;
}

interface AnalysisResult {
  marketStats: {
    avgPrice: number;
    maxPrice: number;
    minPrice: number;
    demandScore: number;
    occupancyRate: number;
  };
  performance: {
    rating: number;
    reviewsCount: number;
    responseRate: number;
    isSuperhost: boolean;
  };
  competitors: Competitor[];
  suggestion: number;
  confidence: number;
}

// ─── Static config ─────────────────────────────────────────────────────────────

const defaultRules: PricingRule[] = [
  {
    id: "last_minute",
    name: "Última Hora",
    description: "Descuento automático 7 días antes si ocupación < 50%",
    icon: "Clock",
    iconColor: "text-amber-500",
    enabled: true,
    adjustment: 15,
    type: "discount",
    condition: "7 días antes del check-in · ocupación < 50%",
    impact: "Llena noches vacías. Promedio +2.3 noches/mes",
  },
  {
    id: "weekend_premium",
    name: "Premium Fin de Semana",
    description: "Sube precio automáticamente en Vie/Sáb/Dom",
    icon: "Flame",
    iconColor: "text-rose-500",
    enabled: true,
    adjustment: 20,
    type: "premium",
    condition: "Viernes · Sábado · Domingo",
    impact: "+$340 USD promedio mensual en tu portafolio",
  },
  {
    id: "gap_night",
    name: "Noche Huérfana",
    description: "Descuento para gaps de 1-2 noches entre reservas",
    icon: "Moon",
    iconColor: "text-indigo-500",
    enabled: false,
    adjustment: 25,
    type: "discount",
    condition: "Gap de 1-2 noches entre dos reservas",
    impact: "Convierte 80% de gaps en reservas → +$180/mes",
  },
  {
    id: "long_stay",
    name: "Estancia Larga",
    description: "Descuento por estadías de 7+ noches",
    icon: "Calendar",
    iconColor: "text-emerald-500",
    enabled: true,
    adjustment: 10,
    type: "discount",
    condition: "Reservas ≥ 7 noches",
    impact: "Reduce costos operativos. +$420 RevPAR/mes",
  },
  {
    id: "high_season",
    name: "Temporada Alta",
    description: "Sube tarifa base en meses de alta demanda",
    icon: "TrendingUp",
    iconColor: "text-amber-600",
    enabled: true,
    adjustment: 30,
    type: "premium",
    condition: "Enero · Febrero · Marzo · Diciembre",
    impact: "Captura el pico de demanda invernal",
  },
];

const weeklyForecast = [
  { day: "Lun", price: 180, market: 172, occupancy: 70 },
  { day: "Mar", price: 175, market: 170, occupancy: 65 },
  { day: "Mié", price: 185, market: 178, occupancy: 72 },
  { day: "Jue", price: 195, market: 185, occupancy: 78 },
  { day: "Vie", price: 245, market: 210, occupancy: 95 },
  { day: "Sáb", price: 260, market: 225, occupancy: 98 },
  { day: "Dom", price: 220, market: 195, occupancy: 85 },
];

const priceFactors = [
  { name: "Demanda local", impact: 85, trend: "up" },
  { name: "Eventos cercanos", impact: 72, trend: "up" },
  { name: "Estacionalidad", impact: 65, trend: "up" },
  { name: "Competencia", impact: 45, trend: "down" },
  { name: "Día de la semana", impact: 60, trend: "up" },
];

const mockGapNights = [
  { from: "Mar 14", to: "Mar 16", nights: 2, property: "Villa Mar Azul", suggestedDiscount: 25 },
  { from: "Mar 19", to: "Mar 20", nights: 1, property: "Loft Moderno", suggestedDiscount: 30 },
];

export default function DynamicPricingPanel() {
  const [selectedProperty, setSelectedProperty] = useState("all");
  const [autoAdjust, setAutoAdjust] = useState(true);
  const [strategy, setStrategy] = useState<"conservative" | "recommended" | "aggressive">("recommended");
  const [rules, setRules] = useState<PricingRule[]>(() => {
    if (typeof window === "undefined") return defaultRules;
    try {
      const saved = localStorage.getItem("stayhost_pricing_rules");
      return saved ? JSON.parse(saved) : defaultRules;
    } catch {
      return defaultRules;
    }
  });

  // Scraper Logic
  const [url, setUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [scrapingStep, setScrapingStep] = useState<string | null>(null);

  const [properties, setProperties] = useState<Property[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("stayhost_properties");
      if (raw) setProperties(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("stayhost_pricing_rules", JSON.stringify(rules));
  }, [rules]);

  const handleAnalyze = () => {
    if (!url) return;
    setIsAnalyzing(true);
    setAnalysisResult(null);

    const steps = [
      "Conectando con Airbnb/Booking...",
      "Extrayendo metadatos del anuncio...",
      "Identificando amenidades (Piscina, Shuttle, Seguridad)...",
      "Analizando micro-ubicación...",
      "Calculando Índice de Similitud...",
    ];

    let i = 0;
    const interval = setInterval(() => {
      if (i < steps.length) {
        setScrapingStep(steps[i]);
        i++;
      } else {
        clearInterval(interval);
        setScrapingStep(null);
        setAnalysisResult({
          marketStats: {
            avgPrice: 68,
            maxPrice: 115,
            minPrice: 42,
            demandScore: 88,
            occupancyRate: 74
          },
          performance: {
            rating: 4.88,
            reviewsCount: 42,
            responseRate: 100,
            isSuperhost: true
          },
          competitors: [
            {
              name: "Arena Gorda Ocean Breeze",
              price: 55,
              distance: "0.3km",
              rating: 4.2,
              amenities: ["Piscina"],
              segment: "Económico",
              similitud: 82
            },
            {
              name: "Luxury Condo White Sands",
              price: 89,
              distance: "0.1km",
              rating: 4.9,
              amenities: ["Piscina", "Shuttle", "Gym"],
              segment: "Premium",
              similitud: 96
            },
            {
              name: "Relaxing Golf Suite",
              price: 72,
              distance: "0.6km",
              rating: 4.5,
              amenities: ["Piscina", "A/C"],
              segment: "Competencia Directa",
              similitud: 91
            }
          ],
          suggestion: 82,
          confidence: 94
        });
        setIsAnalyzing(false);
      }
    }, 800);
  };

  const portfolioMetrics = useMemo(() => {
    const propList = properties.length > 0 ? properties : [
      { id: "1", name: "Villa Mar Azul", basePrice: 200 },
      { id: "2", name: "Apartamento Centro", basePrice: 80 },
      { id: "3", name: "Casa de Playa", basePrice: 300 },
      { id: "4", name: "Loft Moderno", basePrice: 100 },
    ];

    const stratMultiplier = strategy === "conservative" ? 0.92 : strategy === "aggressive" ? 1.12 : 1.0;
    const baseOcc = strategy === "conservative" ? 88 : strategy === "aggressive" ? 68 : 79;

    return propList.map((p, i) => {
      const base = (p.basePrice as number) || [200, 80, 300, 100][i % 4] || 120;
      const suggested = Math.round(base * stratMultiplier * (1 + [0.22, 0.18, -0.07, 0.30][i % 4]));
      const occupancy = baseOcc + [-7, 8, -3, 11][i % 4];
      const change = ((suggested - base) / base) * 100;
      return { ...p, base, suggested, occupancy, change };
    });
  }, [properties, strategy]);

  const kpis = useMemo(() => {
    const adr = portfolioMetrics.reduce((s, p) => s + p.suggested, 0) / Math.max(portfolioMetrics.length, 1);
    const avgOcc = portfolioMetrics.reduce((s, p) => s + p.occupancy, 0) / Math.max(portfolioMetrics.length, 1);
    const revpar = adr * (avgOcc / 100);
    const revenueMTD = portfolioMetrics.reduce((s, p) => s + p.suggested * (p.occupancy / 100) * 30, 0);

    return {
      adr: Math.round(adr),
      occupancy: Math.round(avgOcc),
      revpar: Math.round(revpar),
      revenueMTD: Math.round(revenueMTD)
    };
  }, [portfolioMetrics]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Precios Dinámicos</h2>
          <p className="text-slate-500">Configura tus estrategias de precios automáticos</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedProperty} onValueChange={setSelectedProperty}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Seleccionar propiedad" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las propiedades</SelectItem>
              {portfolioMetrics.map(p => (
                <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" className="h-10 w-10">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-xl border-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-100 uppercase tracking-wider">RevPAR Estimado</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tracking-tight">${kpis.revpar}</div>
            <p className="text-xs text-blue-200 mt-2 flex items-center gap-1 font-medium bg-white/10 w-fit px-2 py-0.5 rounded-full">
              <TrendingUp className="h-3 w-3" /> +12.4% vs mes anterior
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Ocupación Media</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{kpis.occupancy}%</div>
            <div className="mt-2 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${kpis.occupancy}%` }} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Tarifa Media (ADR)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${kpis.adr}</div>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
              <DollarSign className="h-3 w-3" /> Basado en {portfolioMetrics.length} propiedades
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">Ingresos Proyectados (MTD)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${kpis.revenueMTD.toLocaleString()}</div>
            <p className="text-xs text-slate-500 mt-1 italic">Pronóstico basado en tendencia</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="space-y-1">
                <CardTitle>Configurador de Peras con Peras</CardTitle>
                <CardDescription>Analiza la competencia directa copiando la URL de su anuncio</CardDescription>
              </div>
              <Globe className="h-5 w-5 text-slate-400" />
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="flex gap-3">
                <Input 
                  placeholder="Pegar URL de Airbnb o Booking del competidor..." 
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="flex-1"
                />
                <Button onClick={handleAnalyze} disabled={isAnalyzing || !url}>
                  {isAnalyzing ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Analizar Competidor"}
                </Button>
              </div>

              {isAnalyzing && (
                <div className="p-6 border-2 border-dashed border-slate-200 rounded-xl space-y-4 animate-in fade-in duration-500">
                  <div className="flex flex-col items-center justify-center text-center space-y-3">
                    <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center">
                      <Search className="h-6 w-6 text-blue-500 animate-pulse" />
                    </div>
                    <div className="space-y-1">
                      <p className="font-bold text-slate-900 uppercase tracking-tight">{scrapingStep}</p>
                      <p className="text-[11px] text-slate-400 font-medium">Extrayendo inteligencia competitiva en tiempo real...</p>
                    </div>
                  </div>
                  <Progress value={isAnalyzing ? undefined : 100} className="h-1" />
                </div>
              )}

              {analysisResult && !isAnalyzing && (
                <div className="space-y-6 animate-in slide-in-from-top-4 duration-500">
                  <div className="grid md:grid-cols-3 gap-4">
                    <div className="p-5 bg-blue-50/50 rounded-2xl border border-blue-100 shadow-sm relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                        <DollarSign className="h-12 w-12 text-blue-600" />
                      </div>
                      <p className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-2">Precio Mercado</p>
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-black text-slate-900">${analysisResult.marketStats.avgPrice}</span>
                        <span className="text-xs font-medium text-slate-400 italic">media / noche</span>
                      </div>
                    </div>
                    
                    <div className="p-5 bg-white rounded-2xl border border-slate-100 shadow-sm relative group">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Índice Similitud</p>
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <div className="flex justify-between items-center mb-1">
                             <span className="text-2xl font-black text-slate-900">{analysisResult.confidence}%</span>
                             <Badge className="bg-emerald-50 text-emerald-600 border-none text-[9px] font-bold">ALTA</Badge>
                          </div>
                          <Progress value={analysisResult.confidence} className="h-1.5 bg-slate-100 [&>div]:bg-blue-600" />
                        </div>
                      </div>
                    </div>

                    <div className="p-5 bg-amber-50 rounded-2xl border border-amber-200 shadow-sm shadow-amber-100 relative overflow-hidden">
                      <div className="absolute -right-2 -bottom-2 opacity-10">
                        <Zap className="h-16 w-16 text-amber-500 fill-amber-500" />
                      </div>
                      <p className="text-xs font-bold text-amber-700 uppercase tracking-widest mb-2">Recomendación AI</p>
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-black text-amber-900">${analysisResult.suggestion}</span>
                        <span className="text-[10px] font-bold text-amber-600 bg-white px-2 py-0.5 rounded-full shadow-sm">OPCIÓN ÓPTIMA</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between">
                       <h4 className="font-bold text-slate-900 flex items-center gap-2">
                        <Target className="h-4 w-4 text-blue-600" />
                        Benchmarks de la Micro-Zona
                      </h4>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Comparando 12 factores de éxito</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {analysisResult.competitors.map((comp, idx) => (
                        <div key={idx} className="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-2xl shadow-sm hover:border-blue-200 hover:shadow-md transition-all group">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center group-hover:bg-blue-50 transition-colors">
                              <Globe className="h-6 w-6 text-slate-400 group-hover:text-blue-500 transition-colors" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-bold text-slate-900 truncate max-w-[150px]">{comp.name}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                 <Badge variant="outline" className="text-[9px] px-1.5 h-4 border-slate-200 text-slate-500 leading-none">{comp.distance}</Badge>
                                 <Badge variant="outline" className="text-[9px] px-1.5 h-4 border-blue-100 text-blue-600 bg-blue-50/30 leading-none">{comp.similitud}% Match</Badge>
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xl font-black text-slate-900">${comp.price}</p>
                            <div className="flex items-center justify-end gap-1">
                              <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                              <span className="text-xs font-bold text-slate-600">{comp.rating}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 p-4 rounded-2xl bg-slate-50 border border-dashed border-slate-200">
                       <div className="flex items-start gap-4">
                          <div className="p-2 bg-white rounded-lg shadow-sm border border-slate-100">
                             <InfoIcon className="h-5 w-5 text-blue-500" />
                          </div>
                          <div>
                             <p className="text-xs font-bold text-slate-900">Análisis Detallado de Amenidades</p>
                             <p className="text-[11px] text-slate-500 mt-1">
                               Detectamos que el 80% de tus competidores premium ofrecen <strong>Shuttle Service</strong> y <strong>Desayuno Incluido</strong>. Considera agregarlos para justificar un incremento de precio del 15%.
                             </p>
                          </div>
                       </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Optimización Dinámica</CardTitle>
                  <CardDescription>Sugerencias de precios por propiedad</CardDescription>
                </div>
                <div className="flex bg-slate-100 p-1 rounded-lg">
                  <Button 
                    variant={strategy === "conservative" ? "secondary" : "ghost"} 
                    size="sm" 
                    className="text-xs px-2 h-7"
                    onClick={() => setStrategy("conservative")}
                  >
                    Ocupación
                  </Button>
                  <Button 
                    variant={strategy === "recommended" ? "secondary" : "ghost"} 
                    size="sm" 
                    className="text-xs px-2 h-7"
                    onClick={() => setStrategy("recommended")}
                  >
                    Equilibrio
                  </Button>
                  <Button 
                    variant={strategy === "aggressive" ? "secondary" : "ghost"} 
                    size="sm" 
                    className="text-xs px-2 h-7"
                    onClick={() => setStrategy("aggressive")}
                  >
                    Márgenes
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="space-y-4">
                {portfolioMetrics.map((prop) => (
                  <div key={prop.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 group transition-all hover:bg-white hover:shadow-lg">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-white border border-slate-200 flex items-center justify-center relative overflow-hidden">
                        <Target className="h-6 w-6 text-amber-500" />
                        <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900">{prop.name}</h4>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px] h-4 px-1">{prop.occupancy}% Ocupación</Badge>
                          <span className="text-xs text-slate-500">Base: ${prop.base}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <p className="text-lg font-bold text-slate-900">${prop.suggested}</p>
                          <span className={cn(
                            "text-[10px] font-bold px-1 rounded",
                            prop.change > 0 ? "text-emerald-600 bg-emerald-50" : "text-amber-600 bg-amber-50"
                          )}>
                             {prop.change > 0 ? "+" : ""}{prop.change.toFixed(0)}%
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Tarifa Sugerida AI</p>
                      </div>
                      <Button size="icon" className="h-10 w-10 bg-amber-500 hover:bg-amber-600 text-white rounded-xl shadow-lg shadow-amber-500/20 group-hover:scale-105 transition-transform">
                        <Zap className="h-4 w-4 fill-white" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="bg-white border-blue-100 shadow-md overflow-hidden">
            <CardHeader className="pb-2 bg-slate-50/50 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <CardTitle className="text-slate-900 text-lg flex items-center gap-2">
                  <BrainCircuit className="h-5 w-5 text-blue-600" />
                  Reglas del Algoritmo
                </CardTitle>
                <Badge variant="secondary" className="bg-blue-50 text-blue-600 hover:bg-blue-50 border-blue-100 text-[10px] font-bold">
                  IA ACTIVA
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-3">
                {rules.map((rule) => {
                  const RuleIcon = ICON_MAP[rule.icon] || BrainCircuit;
                  return (
                    <div key={rule.id} className="p-4 bg-white rounded-xl border border-slate-100 group hover:border-blue-200 transition-all hover:shadow-sm">
                      <div className="flex items-start gap-4">
                        <div className={cn(
                          "p-2.5 rounded-xl transition-colors",
                          rule.enabled ? "bg-blue-50 text-blue-600" : "bg-slate-50 text-slate-400"
                        )}>
                          <RuleIcon className="h-5 w-5" />
                        </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <p className="font-bold text-slate-900 text-sm">{rule.name}</p>
                          <button
                            onClick={() => {
                              setRules(rules.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r));
                            }}
                            className={cn(
                              "w-10 h-5 rounded-full p-1 transition-colors relative",
                              rule.enabled ? "bg-blue-600" : "bg-slate-200"
                            )}
                          >
                            <div className={cn(
                              "w-3 h-3 bg-white rounded-full transition-transform shadow-sm",
                              rule.enabled ? "translate-x-5" : "translate-x-0"
                            )} />
                          </button>
                        </div>
                        <p className="text-[11px] text-slate-500 font-medium mb-2 leading-tight">{rule.description}</p>
                        <div className="flex items-center gap-3">
                           <span className={cn(
                             "text-[10px] px-2 py-0.5 rounded-full font-bold",
                             rule.type === 'premium' ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"
                           )}>
                             {rule.type === 'premium' ? "+" : "-"}{rule.adjustment}%
                           </span>
                           <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{rule.impact.split('→')[0]}</span>
                         </div>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
              <Button variant="outline" className="w-full text-slate-500 hover:text-blue-600 text-xs h-9 border-slate-200 hover:border-blue-200 hover:bg-blue-50 font-bold transition-all">
                NUEVA REGLA PERSONALIZADA +
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-blue-500" />
                Previsión Semanal
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="space-y-4">
                <div className="flex items-end gap-2 h-32 pt-4">
                  {weeklyForecast.map((day, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-2 h-full justify-end group cursor-help">
                      <div className="w-full bg-slate-100 rounded-t-xl transition-all hover:bg-blue-100 relative group/bar" style={{ height: `${(day.price/260)*100}%` }}>
                        <div className="absolute inset-x-0 bottom-0 bg-blue-600 opacity-30 h-[30%] rounded-t-xl group-hover/bar:h-full transition-all duration-300" />
                        <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-[10px] px-2 py-1 rounded-lg opacity-0 group-hover/bar:opacity-100 transition-all pointer-events-none z-20 shadow-xl scale-95 group-hover/bar:scale-100 font-bold">
                          ${day.price}
                        </div>
                      </div>
                      <span className="text-[10px] font-bold text-slate-400">{day.day}</span>
                    </div>
                  ))}
                </div>
                <div className="p-3 bg-slate-50 rounded-xl space-y-2 border border-slate-100">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500">Demanda Estimada</span>
                    <span className="font-bold text-slate-900 flex items-center gap-1">
                      En aumento <TrendingUp className="h-3 w-3 text-emerald-500" />
                    </span>
                  </div>
                  <Progress value={85} className="h-1.5 bg-slate-200 [&>div]:bg-blue-500" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-amber-200 bg-amber-50/30">
             <CardHeader className="pb-2">
                <CardTitle className="text-amber-900 text-sm flex items-center gap-2">
                   <AlertTriangle className="h-4 w-4 text-amber-500" />
                   Noches Huérfanas
                </CardTitle>
             </CardHeader>
             <CardContent className="space-y-3 pt-2">
                {mockGapNights.map((gap, i) => (
                  <div key={i} className="p-3 bg-white border border-amber-100 rounded-xl shadow-sm">
                     <p className="text-xs font-black text-amber-900 uppercase tracking-tighter">{gap.property}</p>
                     <div className="flex justify-between items-center mt-1">
                        <span className="text-[10px] font-bold text-slate-500">{gap.from} ({gap.nights} noches)</span>
                        <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-none text-[9px]">-{gap.suggestedDiscount}%</Badge>
                     </div>
                  </div>
                ))}
                <Button className="w-full bg-amber-500 hover:bg-amber-600 text-white font-black text-[10px] uppercase shadow-lg shadow-amber-500/20">
                   Automatizar Gaps
                </Button>
             </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

