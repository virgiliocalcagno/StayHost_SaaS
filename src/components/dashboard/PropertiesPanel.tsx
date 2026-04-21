"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  Search,
  LayoutGrid,
  List,
  MapPin,
  Users,
  Star,
  Bed,
  Bath,
  Wifi,
  Car,
  MoreVertical,
  Home,
  TrendingUp,
  DollarSign,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Settings,
  Edit3,
  Trash2,
  Eye,
  X,
  Building2,
  Waves,
  TreePine,
  ImageIcon,
  Link2,
  ExternalLink,
  Clock,
  RefreshCw,
  Box,
  Package,
  Layers,
  Archive,
  Bot,
  ChevronUp,
  ChevronDown,
  ClipboardList,
  FileText,
  Camera,
  Sparkles,
  ImagePlus,
  Globe,
  GripVertical,
  Crown,
  CalendarRange,
  Copy,
  Info,
  Zap,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────────────────────
interface ChannelLink {
  name: string;
  connected: boolean;
  color: string;
  icon: string;
  listingUrl?: string;
  icalUrl?: string;
  lastSync?: string;
}

export interface SupplyRule {
  item: string;
  minDays: number;
  maxDays: number;
  quantity: number;
}

export interface PhotoTourRoom {
  id: string;
  name: string;
  type: 'bedroom' | 'bathroom' | 'living' | 'kitchen' | 'outdoor' | 'other';
  images: string[];
}

export interface AmenitiesConfig {
  popular: string[];
  bathroom: string[];
  bedroom: string[];
  kitchen: string[];
  outdoor: string[];
}

interface Property {
  id: string;
  name: string;
  address: string;
  city: string;
  image: string;
  type: "apartment" | "house" | "villa" | "loft" | "cabin";
  price: number;
  cleaningFeeOneDay?: number;
  cleaningFeeMoreDays?: number;
  weeklyDiscountPercent?: number;
  energyFeePerDay?: number;
  additionalServicesFee?: number;
  currency: string;
  rating: number;
  reviews: number;
  beds: number;
  baths: number;
  maxGuests: number;
  status: "active" | "maintenance" | "inactive";
  bookingStatus: "occupied" | "available" | "checkout_today" | "checkin_today";
  occupancy: number;
  monthlyRevenue: number;
  channels: ChannelLink[];
  amenities: string[];
  ownerPayout: number;
  staffPay: number;
  nextCheckIn?: string;
  nextGuest?: string;
  currentGuest?: string;
  recurringSupplies?: SupplyRule[];
  autoAssignCleaner?: boolean;
  cleanerPriorities?: string[];
  bedConfiguration?: string;      // ej. "2 Queen, 1 Sofa-cama"
  standardInstructions?: string;  // instrucciones base que se importan a cada tarea
  evidenceCriteria?: string[];    // criterios de fotos obligatorias (ej: ["Cocina", "Baño"])
  descriptionES?: string;
  descriptionEN?: string;
  photoTour?: PhotoTourRoom[];
  amenitiesConfig?: AmenitiesConfig;
  wifiSsid?: string;
  wifiPassword?: string;
  electricityEnabled?: boolean;
  electricityRate?: number;
  checkInTime?: string;
  checkOutTime?: string;
  ttlockLockId?: string;
}

// ─── Mock Data ──────────────────────────────────────────────────────────────
const mockProperties: Property[] = [
  {
    id: "1",
    name: "Villa Mar Azul",
    address: "Blvd. Kukulcán Km 12.5, Zona Hotelera",
    city: "Cancún, Q. Roo",
    image: "https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=600&h=400&fit=crop",
    type: "villa",
    price: 250,
    currency: "USD",
    rating: 4.9,
    reviews: 124,
    beds: 4,
    baths: 3,
    maxGuests: 8,
    status: "active",
    bookingStatus: "occupied",
    currentGuest: "Carlos Mendoza",
    occupancy: 85,
    monthlyRevenue: 18750,
    channels: [
      { name: "Airbnb", connected: true, color: "bg-rose-500", icon: "A", listingUrl: "https://www.airbnb.com/rooms/12345678", icalUrl: "https://www.airbnb.com/calendar/ical/12345678.ics" },
      { name: "Booking", connected: true, color: "bg-blue-600", icon: "B", listingUrl: "https://www.booking.com/hotel/mx/villa-mar-azul.html", icalUrl: "" },
      { name: "VRBO", connected: false, color: "bg-indigo-500", icon: "V" },
      { name: "Directa", connected: true, color: "bg-emerald-500", icon: "D" },
    ],
    amenities: ["wifi", "pool", "parking", "ac", "kitchen"],
    ownerPayout: 12500,
    staffPay: 180,
    nextCheckIn: "14 Abr 15:00",
    nextGuest: "Ana López",
    descriptionES: "Espectacular villa con vista al mar caribe. Disfruta de la brisa marina y las puestas de sol más increíbles desde nuestra terraza privada. Totalmente equipada para familias exigentes.",
    descriptionEN: "Spectacular villa with Caribbean Sea views. Enjoy the sea breeze and the most incredible sunsets from our private terrace. Fully equipped for demanding families.",
    photoTour: [
      {
        id: "room-1",
        name: "Sala Principal",
        type: "living",
        images: [
          "https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=600&h=400&fit=crop",
          "https://images.unsplash.com/photo-1567016432779-094069958ea5?w=600&h=400&fit=crop"
        ]
      },
      {
        id: "room-2",
        name: "Cocina Gourmet",
        type: "kitchen",
        images: [
          "https://images.unsplash.com/photo-1556911220-e15224bbff21?w=600&h=400&fit=crop"
        ]
      }
    ],
    amenitiesConfig: {
      popular: ["wifi", "pool", "ac", "parking", "kitchen"],
      bathroom: ["hotWater", "hairDryer"],
      bedroom: ["essentials", "hangers", "iron"],
      kitchen: [],
      outdoor: []
    }
  },
  {
    id: "2",
    name: "Apartamento Centro Histórico",
    address: "Calle Regina 45, Centro",
    city: "Ciudad de México",
    image: "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=600&h=400&fit=crop",
    type: "apartment",
    price: 95,
    currency: "USD",
    rating: 4.7,
    reviews: 89,
    beds: 2,
    baths: 1,
    maxGuests: 4,
    status: "active",
    bookingStatus: "available",
    occupancy: 72,
    monthlyRevenue: 8550,
    channels: [
      { name: "Airbnb", connected: true, color: "bg-rose-500", icon: "A", listingUrl: "https://www.airbnb.com/rooms/87654321", icalUrl: "https://www.airbnb.com/calendar/ical/87654321.ics", lastSync: "2024-04-08T10:30:00Z" },
      { name: "Booking", connected: true, color: "bg-blue-600", icon: "B", listingUrl: "https://www.booking.com/hotel/mx/apto-centro.html" },
      { name: "VRBO", connected: false, color: "bg-indigo-500", icon: "V" },
      { name: "Directa", connected: false, color: "bg-emerald-500", icon: "D" },
    ],
    amenities: ["wifi", "ac", "kitchen"],
    ownerPayout: 5700,
    staffPay: 120,
    nextCheckIn: "Mañana 14:00",
    nextGuest: "Pedro García",
  },
  {
    id: "3",
    name: "Casa de Playa Sunset",
    address: "Av. de las Garzas 200, Zona Romántica",
    city: "Puerto Vallarta, Jal.",
    image: "https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?w=600&h=400&fit=crop",
    type: "house",
    price: 350,
    currency: "USD",
    rating: 4.95,
    reviews: 156,
    beds: 5,
    baths: 4,
    maxGuests: 10,
    status: "active",
    bookingStatus: "checkin_today",
    occupancy: 68,
    monthlyRevenue: 22400,
    channels: [
      { name: "Airbnb", connected: true, color: "bg-rose-500", icon: "A", listingUrl: "https://www.airbnb.com/rooms/55555555", icalUrl: "https://www.airbnb.com/calendar/ical/55555555.ics" },
      { name: "Booking", connected: true, color: "bg-blue-600", icon: "B" },
      { name: "VRBO", connected: true, color: "bg-indigo-500", icon: "V" },
      { name: "Directa", connected: true, color: "bg-emerald-500", icon: "D" },
    ],
    amenities: ["wifi", "pool", "parking", "ac", "kitchen", "beach"],
    ownerPayout: 15000,
    staffPay: 220,
    nextCheckIn: "12 Abr 16:00",
    nextGuest: "The Smith Family",
  },
  {
    id: "4",
    name: "Loft Moderno Polanco",
    address: "Av. Presidente Masaryk 201, Polanco",
    city: "CDMX",
    image: "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=600&h=400&fit=crop",
    type: "loft",
    price: 120,
    currency: "USD",
    rating: 4.6,
    reviews: 67,
    beds: 1,
    baths: 1,
    maxGuests: 2,
    status: "maintenance",
    bookingStatus: "available",
    occupancy: 90,
    monthlyRevenue: 10800,
    channels: [
      { name: "Airbnb", connected: true, color: "bg-rose-500", icon: "A" },
      { name: "Booking", connected: false, color: "bg-blue-600", icon: "B" },
      { name: "VRBO", connected: false, color: "bg-indigo-500", icon: "V" },
      { name: "Directa", connected: false, color: "bg-emerald-500", icon: "D" },
    ],
    amenities: ["wifi", "ac", "kitchen", "gym"],
    ownerPayout: 7200,
    staffPay: 100,
  },
  {
    id: "5",
    name: "Cabaña Bosque Encantado",
    address: "Camino Real S/N, Valle de Bravo",
    city: "Estado de México",
    image: "https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?w=600&h=400&fit=crop",
    type: "cabin",
    price: 180,
    currency: "USD",
    rating: 4.85,
    reviews: 43,
    beds: 3,
    baths: 2,
    maxGuests: 6,
    status: "active",
    bookingStatus: "checkout_today",
    occupancy: 55,
    monthlyRevenue: 9900,
    channels: [
      { name: "Airbnb", connected: true, color: "bg-rose-500", icon: "A" },
      { name: "Booking", connected: false, color: "bg-blue-600", icon: "B" },
      { name: "VRBO", connected: false, color: "bg-indigo-500", icon: "V" },
      { name: "Directa", connected: true, color: "bg-emerald-500", icon: "D" },
    ],
    amenities: ["wifi", "fireplace", "parking", "kitchen", "nature"],
    ownerPayout: 6600,
    staffPay: 150,
    nextCheckIn: "15 Abr 12:00",
    nextGuest: "Roberto & Familia",
  },
];

// ─── Property Type Config ───────────────────────────────────────────────────
const typeConfig: Record<string, { label: string; icon: React.ReactNode }> = {
  apartment: { label: "Apartamento", icon: <Building2 className="h-3.5 w-3.5" /> },
  house: { label: "Casa", icon: <Home className="h-3.5 w-3.5" /> },
  villa: { label: "Villa", icon: <Waves className="h-3.5 w-3.5" /> },
  loft: { label: "Loft", icon: <Building2 className="h-3.5 w-3.5" /> },
  cabin: { label: "Cabaña", icon: <TreePine className="h-3.5 w-3.5" /> },
};

// ─── Component ──────────────────────────────────────────────────────────────
// ─── Devices Tab (lock selector + check-in times + wifi + electricity) ────────
type LockOption = { lockId: string; name: string; accountId: string; accountLabel: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DevicesTabContent({ formData, setFormData }: { formData: any; setFormData: any }) {
  const [locks, setLocks] = useState<LockOption[]>([]);
  const [loadingLocks, setLoadingLocks] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingLocks(true);
      try {
        const accRes = await fetch("/api/ttlock/accounts", { credentials: "same-origin" });
        if (!accRes.ok) { setLoadingLocks(false); return; }
        const accData = await accRes.json();
        const accounts = accData.accounts ?? [];
        const allLocks: LockOption[] = [];
        for (const acc of accounts) {
          try {
            const res = await fetch("/api/ttlock/accounts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({ action: "listLocks", accountId: acc.id }),
            });
            if (!res.ok) continue;
            const data = await res.json();
            for (const l of data.locks ?? []) {
              allLocks.push({ lockId: String(l.lockId), name: l.name ?? `Cerradura ${l.lockId}`, accountId: acc.id, accountLabel: acc.label ?? acc.ttlock_username });
            }
          } catch {}
        }
        if (!cancelled) setLocks(allLocks);
      } catch {}
      if (!cancelled) setLoadingLocks(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* ── Cerradura Inteligente ────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold flex items-center gap-2">
            <Settings className="h-4 w-4 text-primary" /> Cerradura Inteligente
          </h4>
        </div>
        <div className="grid gap-4 p-4 rounded-2xl bg-muted/20 border border-dashed">
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Vincular Cerradura</Label>
            {loadingLocks ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Cargando cerraduras...
              </div>
            ) : locks.length > 0 ? (
              <Select value={formData.ttlockLockId || "__none__"} onValueChange={(v) => setFormData((p: any) => ({ ...p, ttlockLockId: v === "__none__" ? "" : v }))}>
                <SelectTrigger className="bg-white rounded-xl">
                  <SelectValue placeholder="Seleccionar cerradura..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin cerradura</SelectItem>
                  {locks.map((l) => (
                    <SelectItem key={l.lockId} value={l.lockId}>
                      {l.name} <span className="text-muted-foreground ml-1">({l.accountLabel})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">No hay cerraduras disponibles. Conecta una cuenta TTLock en Dispositivos Inteligentes.</p>
                <Input
                  placeholder="O ingresa el Lock ID manualmente"
                  className="bg-white"
                  value={formData.ttlockLockId}
                  onChange={(e) => setFormData((p: any) => ({ ...p, ttlockLockId: e.target.value }))}
                />
              </div>
            )}
            <p className="text-[10px] text-muted-foreground italic">La cerradura vinculada recibe PINs automáticos al crear reservas con teléfono.</p>
          </div>
        </div>
      </div>

      {/* ── Horarios Check-in / Check-out ─────────────────────── */}
      <div className="space-y-4">
        <h4 className="text-sm font-bold flex items-center gap-2">
          <Clock className="h-4 w-4 text-violet-500" /> Horarios de Check-in / Check-out
        </h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs">Hora de Check-in</Label>
            <Input type="time" value={formData.checkInTime} onChange={(e) => setFormData((p: any) => ({ ...p, checkInTime: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Hora de Check-out</Label>
            <Input type="time" value={formData.checkOutTime} onChange={(e) => setFormData((p: any) => ({ ...p, checkOutTime: e.target.value }))} />
          </div>
        </div>
        <div className="p-3 rounded-xl bg-violet-50 border border-violet-100 flex gap-3">
          <Info className="h-4 w-4 text-violet-500 shrink-0 mt-0.5" />
          <p className="text-[10px] text-violet-700 leading-relaxed">El PIN se activa a la hora de check-in y se desactiva a la hora de check-out.</p>
        </div>
      </div>

      {/* ── Conectividad WiFi ───────────────────────────────────── */}
      <div className="space-y-4">
        <h4 className="text-sm font-bold flex items-center gap-2">
          <Wifi className="h-4 w-4 text-blue-500" /> Detalles de Conectividad
        </h4>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs">Nombre de Red (SSID)</Label>
            <Input placeholder="StayHost_Guest_WiFi" value={formData.wifiSsid} onChange={(e) => setFormData((p: any) => ({ ...p, wifiSsid: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Contraseña WiFi</Label>
            <Input type="password" placeholder="********" value={formData.wifiPassword} onChange={(e) => setFormData((p: any) => ({ ...p, wifiPassword: e.target.value }))} />
          </div>
        </div>
        <div className="p-3 rounded-xl bg-blue-50 border border-blue-100 flex gap-3">
          <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
          <p className="text-[10px] text-blue-700 leading-relaxed">Estos datos se envían al huésped en su mensaje de bienvenida 24h antes del check-in.</p>
        </div>
      </div>

      {/* ── Monitoreo de Energía ─────────────────────────────────── */}
      <div className="space-y-4 pt-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500 fill-amber-500" /> Monitoreo de Electricidad
          </h4>
          <div className="flex items-center gap-2 scale-90 origin-right">
            <span className="text-xs font-medium text-muted-foreground">{formData.electricityEnabled ? "Activo" : "Inactivo"}</span>
            <button
              type="button"
              onClick={() => setFormData((p: any) => ({ ...p, electricityEnabled: !p.electricityEnabled }))}
              className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${formData.electricityEnabled ? "bg-primary" : "bg-muted"}`}
            >
              <span className={`${formData.electricityEnabled ? "translate-x-5" : "translate-x-1"} inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform`} />
            </button>
          </div>
        </div>
        <div className={`transition-all duration-300 ${formData.electricityEnabled ? "opacity-100 max-h-40" : "opacity-40 pointer-events-none grayscale"}`}>
          <div className="grid grid-cols-2 gap-4 p-4 rounded-2xl bg-amber-50/30 border border-amber-100">
            <div className="space-y-2">
              <Label className="text-xs">Costo por kWh</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                <Input type="number" step="0.01" className="pl-7 bg-white" placeholder="0.15" value={formData.electricityRate} onChange={(e) => setFormData((p: any) => ({ ...p, electricityRate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Unidad de Medida</Label>
              <div className="h-10 flex items-center px-3 rounded-md bg-white border text-sm text-muted-foreground font-medium">Kilovatios (kWh)</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PropertiesPanel() {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [properties, setProperties] = useState<Property[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("stayhost_properties");
      if (saved) {
        try { return JSON.parse(saved); } catch { /* fall through */ }
      }
    }
    return [];
  });

  // Persist to localStorage on change
  useEffect(() => {
    localStorage.setItem("stayhost_properties", JSON.stringify(properties));
  }, [properties]);

  // Always load from Supabase on mount — source of truth.
  // Tenant is resolved server-side from the session cookie.
  useEffect(() => {
    fetch("/api/properties", { credentials: "same-origin" })
      .then(r => r.json())
      .then(data => {
        if (!data.properties?.length) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fromDb: Property[] = data.properties.map((p: any) => ({
          id: p.id,
          name: p.name,
          address: p.address ?? "",
          city: p.city ?? "",
          image: p.cover_image ?? "",
          type: (p.property_type ?? "apartment") as Property["type"],
          price: p.price ?? 0,
          currency: p.currency ?? "USD",
          rating: 0,
          reviews: 0,
          beds: p.beds ?? 1,
          baths: p.baths ?? 1,
          maxGuests: p.max_guests ?? 2,
          status: (p.prop_status ?? "active") as Property["status"],
          bookingStatus: "available" as Property["bookingStatus"],
          occupancy: 0,
          monthlyRevenue: 0,
          ownerPayout: p.owner_payout ?? 0,
          staffPay: p.staff_pay ?? 0,
          amenities: p.amenities ?? [],
          cleaningFeeOneDay: p.cleaning_fee_one_day ?? 0,
          cleaningFeeMoreDays: p.cleaning_fee_more_days ?? 0,
          weeklyDiscountPercent: p.weekly_discount_percent ?? 0,
          energyFeePerDay: p.energy_fee_per_day ?? 0,
          additionalServicesFee: p.additional_services_fee ?? 0,
          recurringSupplies: p.recurring_supplies ?? [],
          autoAssignCleaner: p.auto_assign_cleaner ?? false,
          cleanerPriorities: p.cleaner_priorities ?? [],
          bedConfiguration: p.bed_configuration ?? undefined,
          standardInstructions: p.standard_instructions ?? undefined,
          evidenceCriteria: p.evidence_criteria ?? [],
          descriptionES: p.description_es ?? undefined,
          descriptionEN: p.description_en ?? undefined,
          photoTour: p.photo_tour ?? [],
          amenitiesConfig: p.amenities_config ?? undefined,
          channels: [
            { name: "Airbnb", connected: !!p.ical_airbnb, color: "bg-rose-500", icon: "A", icalUrl: p.ical_airbnb ?? undefined },
            { name: "Booking", connected: false, color: "bg-blue-600", icon: "B" },
            { name: "VRBO", connected: !!p.ical_vrbo, color: "bg-indigo-500", icon: "V", icalUrl: p.ical_vrbo ?? undefined },
            { name: "Directa", connected: p.direct_enabled ?? false, color: "bg-emerald-500", icon: "D" },
          ],
          wifiSsid: p.wifi_name ?? undefined,
          wifiPassword: p.wifi_password ?? undefined,
          electricityEnabled: p.electricity_enabled ?? false,
          electricityRate: p.electricity_rate ?? 0,
          checkInTime: p.check_in_time ?? "14:00",
          checkOutTime: p.check_out_time ?? "12:00",
          ttlockLockId: p.ttlock_lock_id ?? undefined,
        }));
        setProperties(fromDb);
      })
      .catch(() => {});
  }, []);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);

  const [modalTab, setModalTab] = useState<"propiedad" | "photo-tour" | "amenidades" | "comercial" | "dispositivos" | "operativa">("propiedad");
  const [creationStep, setCreationStep] = useState<"options" | "airbnb-import" | "form">("form");
  const [airbnbImportLink, setAirbnbImportLink] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [baseUrl, setBaseUrl] = useState("https://app.stayhost.io");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setBaseUrl(window.location.origin);
    }
  }, []);

  // ─── Cleaners from team (for automation tab) ───────────────────────────────
  const [availableCleaners, setAvailableCleaners] = useState<{id: string; name: string; avatar?: string}[]>([]);
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("stayhost_team");
      if (saved) {
        try {
          const teamData = JSON.parse(saved);
          setAvailableCleaners(teamData.filter((m: any) => m.role === "cleaner"));
        } catch {}
      }
    }
  }, []);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    address: "",
    city: "",
    type: "apartment" as Property["type"],
    price: "",
    beds: "",
    baths: "",
    maxGuests: "",
    airbnbUrl: "",
    airbnbIcal: "",
    bookingUrl: "",
    bookingIcal: "",
    vrboUrl: "",
    vrboIcal: "",
    directaEnabled: false,
    cleaningFeeOneDay: "",
    cleaningFeeMoreDays: "",
    weeklyDiscountPercent: "",
    energyFeePerDay: "",
    additionalServicesFee: "",
    recurringSupplies: [] as SupplyRule[],
    autoAssignCleaner: false,
    cleanerPriorities: [] as string[],
    bedConfiguration: "",
    standardInstructions: "",
    evidenceCriteria: [] as string[],
    descriptionES: "",
    descriptionEN: "",
    photoTour: [] as PhotoTourRoom[],
    amenitiesConfig: {
      popular: [],
      bathroom: [],
      bedroom: [],
      kitchen: [],
      outdoor: []
    } as AmenitiesConfig,
    wifiSsid: "",
    wifiPassword: "",
    electricityEnabled: false,
    electricityRate: "",
    checkInTime: "14:00",
    checkOutTime: "12:00",
    ttlockLockId: "",
  });

  // ─── Filtered ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return properties.filter((p) => {
      const matchesSearch =
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.city.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === "all" || p.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [properties, searchTerm, statusFilter]);

  // ─── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = properties.length;
    const active = properties.filter((p) => p.status === "active").length;
    const avgOccupancy = Math.round(properties.reduce((a, p) => a + p.occupancy, 0) / total);
    const totalRevenue = properties.reduce((a, p) => a + p.monthlyRevenue, 0);
    return { total, active, avgOccupancy, totalRevenue };
  }, [properties]);

  // ─── Sync state ────────────────────────────────────────────────────────────
  const [syncingChannel, setSyncingChannel] = useState<string | null>(null);

  const handleSyncChannel = useCallback(async (channelName: string) => {
    if (!editingProperty) return;
    setSyncingChannel(channelName);
    try {
      // Ensure property exists in Supabase first. Tenant is resolved from session.
      const syncRes = await fetch("/api/properties/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ property: editingProperty }),
      });
      if (syncRes.ok) {
        // Then import iCal bookings
        const importRes = await fetch("/api/ical/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ propertyId: editingProperty.id }),
        });
        const importData = await importRes.json().catch(() => null);
        if (!importRes.ok) {
          toast.error(
            `iCal HTTP ${importRes.status}: ${importData?.error ?? "error desconocido"}`
          );
        } else if (importData) {
          const reservas = importData.imported ?? 0;
          const bloqueos = importData.blocksImported ?? 0;
          if (importData.errors?.length) {
            toast.error(
              `iCal: ${importData.errors[0].message}` +
              (importData.errors.length > 1 ? ` (+${importData.errors.length - 1} más)` : "")
            );
          } else {
            toast.success(`Sync OK: ${reservas} reservas, ${bloqueos} bloqueos`);
          }
          window.dispatchEvent(new CustomEvent("stayhost:bookings-updated"));
        } else {
          toast.error("iCal: respuesta vacía del servidor.");
        }
      } else {
        const errBody = await syncRes.json().catch(() => null);
        toast.error(`Sync propiedad falló: ${errBody?.error ?? syncRes.status}`);
      }
    } catch {}
    const now = new Date().toISOString();
    setProperties((prev) =>
      prev.map((p) =>
        p.id === editingProperty.id
          ? { ...p, channels: p.channels.map((ch) => ch.name === channelName ? { ...ch, lastSync: now } : ch) }
          : p
      )
    );
    setEditingProperty((prev) =>
      prev ? { ...prev, channels: prev.channels.map((ch) => ch.name === channelName ? { ...ch, lastSync: now } : ch) } : null
    );
    setSyncingChannel(null);
  }, [editingProperty]);

  const formatSyncTime = (iso?: string) => {
    if (!iso) return null;
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "Hace un momento";
    if (diffMin < 60) return `Hace ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `Hace ${diffH}h`;
    return d.toLocaleDateString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  };

  const SyncBar = ({ channelName, icalUrl }: { channelName: string; icalUrl?: string }) => {
    const channel = editingProperty?.channels.find(c => c.name === channelName);
    const isSyncing = syncingChannel === channelName;
    const hasIcal = !!icalUrl || !!channel?.icalUrl;
    if (!hasIcal) return null;
    return (
      <div className="flex items-center justify-between p-2 rounded-lg bg-muted/40 border border-dashed border-muted-foreground/20 mt-1">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {channel?.lastSync ? (
            <span>Última sync: <strong className="text-foreground">{formatSyncTime(channel.lastSync)}</strong></span>
          ) : (
            <span>Sin sincronizar aún</span>
          )}
        </div>
        <button
          type="button"
          title={`Sincronizar iCal de ${channelName}`}
          disabled={isSyncing}
          onClick={() => handleSyncChannel(channelName)}
          className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md transition-all ${
            isSyncing
              ? "bg-amber-100 text-amber-700 cursor-wait"
              : "bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer"
          }`}
        >
          <RefreshCw className={`h-3 w-3 ${isSyncing ? "animate-spin" : ""}`} />
          {isSyncing ? "Sincronizando…" : "Sincronizar"}
        </button>
      </div>
    );
  };

  // ─── Handlers ──────────────────────────────────────────────────────────────
  const handleSimulateImport = () => {
    if (!airbnbImportLink) return;
    setIsImporting(true);
    setTimeout(() => {
      setFormData(prev => ({
        ...prev,
        name: "Villa Importada desde Airbnb",
        city: "Tulum, Q.R.",
        address: "Av. Principal 123",
        airbnbUrl: airbnbImportLink,
        price: "150",
        beds: "2",
        baths: "1",
        maxGuests: "4",
        type: "villa"
      }));
      setCreationStep("form");
      setIsImporting(false);
    }, 2000);
  };

  const handleOpenAdd = () => {
    setEditingProperty(null);
    setModalTab("propiedad");
    setCreationStep("options");
    setAirbnbImportLink("");
    setFormData({ name: "", address: "", city: "", type: "apartment", price: "", beds: "", baths: "", maxGuests: "", airbnbUrl: "", airbnbIcal: "", bookingUrl: "", bookingIcal: "", vrboUrl: "", vrboIcal: "", directaEnabled: false, cleaningFeeOneDay: "", cleaningFeeMoreDays: "", weeklyDiscountPercent: "", energyFeePerDay: "", additionalServicesFee: "", recurringSupplies: [], autoAssignCleaner: false, cleanerPriorities: [], bedConfiguration: "", standardInstructions: "", evidenceCriteria: ["Cocina", "Habitación", "Baño"], descriptionEN: "", descriptionES: "", photoTour: [], amenitiesConfig: { popular: [], bathroom: [], bedroom: [], kitchen: [], outdoor: [] }, wifiSsid: "", wifiPassword: "", electricityEnabled: false, electricityRate: "", checkInTime: "14:00", checkOutTime: "12:00", ttlockLockId: "" });
    setShowModal(true);
  };

  const handleOpenEdit = (p: Property) => {
    setEditingProperty(p);
    setModalTab("propiedad");
    setCreationStep("form");
    setFormData({
      name: p.name,
      address: p.address,
      city: p.city,
      type: p.type,
      price: p.price.toString(),
      beds: p.beds.toString(),
      baths: p.baths.toString(),
      maxGuests: p.maxGuests.toString(),
      airbnbUrl: p.channels.find(c => c.name === "Airbnb")?.listingUrl || "",
      airbnbIcal: p.channels.find(c => c.name === "Airbnb")?.icalUrl || "",
      bookingUrl: p.channels.find(c => c.name === "Booking")?.listingUrl || "",
      bookingIcal: p.channels.find(c => c.name === "Booking")?.icalUrl || "",
      vrboUrl: p.channels.find(c => c.name === "VRBO")?.listingUrl || "",
      vrboIcal: p.channels.find(c => c.name === "VRBO")?.icalUrl || "",
      directaEnabled: p.channels.find(c => c.name === "Directa")?.connected || false,
      cleaningFeeOneDay: p.cleaningFeeOneDay?.toString() || "",
      cleaningFeeMoreDays: p.cleaningFeeMoreDays?.toString() || "",
      weeklyDiscountPercent: p.weeklyDiscountPercent?.toString() || "",
      energyFeePerDay: p.energyFeePerDay?.toString() || "",
      additionalServicesFee: p.additionalServicesFee?.toString() || "",
      recurringSupplies: p.recurringSupplies || [],
      autoAssignCleaner: p.autoAssignCleaner || false,
      cleanerPriorities: p.cleanerPriorities || [],
      bedConfiguration: p.bedConfiguration || "",
      standardInstructions: p.standardInstructions || "",
      evidenceCriteria: p.evidenceCriteria || [],
      descriptionES: p.descriptionES || "",
      descriptionEN: p.descriptionEN || "",
      photoTour: p.photoTour || [],
      amenitiesConfig: p.amenitiesConfig || {
        popular: [],
        bathroom: [],
        bedroom: [],
        kitchen: [],
        outdoor: []
      },
      wifiSsid: p.wifiSsid || "",
      wifiPassword: p.wifiPassword || "",
      electricityEnabled: p.electricityEnabled || false,
      electricityRate: p.electricityRate?.toString() || "",
      checkInTime: p.checkInTime || "14:00",
      checkOutTime: p.checkOutTime || "12:00",
      ttlockLockId: p.ttlockLockId || "",
    });
    setShowModal(true);
  };

  const buildChannels = (): ChannelLink[] => [
    { name: "Airbnb", connected: !!formData.airbnbUrl, color: "bg-rose-500", icon: "A", listingUrl: formData.airbnbUrl || undefined, icalUrl: formData.airbnbIcal || undefined, lastSync: editingProperty?.channels.find(c => c.name === "Airbnb")?.lastSync },
    { name: "Booking", connected: !!formData.bookingUrl, color: "bg-blue-600", icon: "B", listingUrl: formData.bookingUrl || undefined, icalUrl: formData.bookingIcal || undefined, lastSync: editingProperty?.channels.find(c => c.name === "Booking")?.lastSync },
    { name: "VRBO", connected: !!formData.vrboUrl, color: "bg-indigo-500", icon: "V", listingUrl: formData.vrboUrl || undefined, icalUrl: formData.vrboIcal || undefined, lastSync: editingProperty?.channels.find(c => c.name === "VRBO")?.lastSync },
    { name: "Directa", connected: formData.directaEnabled, color: "bg-emerald-500", icon: "D" },
  ];

  const syncToSupabase = async (prop: Property) => {
    try {
      // Tenant is resolved server-side from the session cookie.
      const res = await fetch("/api/properties/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ property: prop }),
      });
      return res;
    } catch {
      return null;
    }
  };

  const handleSave = async () => {
    if (!formData.name || !formData.city) return;
    setIsSaving(true);
    const updatedChannels = buildChannels();
    let finalProp: Property;

    if (editingProperty) {
      finalProp = { ...editingProperty, name: formData.name, address: formData.address, city: formData.city, type: formData.type, price: Number(formData.price) || editingProperty.price, beds: Number(formData.beds) || editingProperty.beds, baths: Number(formData.baths) || editingProperty.baths, maxGuests: Number(formData.maxGuests) || editingProperty.maxGuests, channels: updatedChannels, cleaningFeeOneDay: Number(formData.cleaningFeeOneDay) || 0, cleaningFeeMoreDays: Number(formData.cleaningFeeMoreDays) || 0, weeklyDiscountPercent: Number(formData.weeklyDiscountPercent) || 0, energyFeePerDay: Number(formData.energyFeePerDay) || 0, additionalServicesFee: Number(formData.additionalServicesFee) || 0, recurringSupplies: formData.recurringSupplies, autoAssignCleaner: formData.autoAssignCleaner, cleanerPriorities: formData.cleanerPriorities, bedConfiguration: formData.bedConfiguration, standardInstructions: formData.standardInstructions, evidenceCriteria: formData.evidenceCriteria, descriptionES: formData.descriptionES, descriptionEN: formData.descriptionEN, photoTour: formData.photoTour, amenitiesConfig: formData.amenitiesConfig, wifiSsid: formData.wifiSsid, wifiPassword: formData.wifiPassword, electricityEnabled: formData.electricityEnabled, electricityRate: Number(formData.electricityRate) || 0, checkInTime: formData.checkInTime, checkOutTime: formData.checkOutTime, ttlockLockId: formData.ttlockLockId };
    } else {
      finalProp = {
        id: crypto.randomUUID(),
        name: formData.name,
        address: formData.address,
        city: formData.city,
        type: formData.type,
        image: "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600&h=400&fit=crop",
        price: Number(formData.price) || 100,
        currency: "USD",
        cleaningFeeOneDay: Number(formData.cleaningFeeOneDay) || 0,
        cleaningFeeMoreDays: Number(formData.cleaningFeeMoreDays) || 0,
        weeklyDiscountPercent: Number(formData.weeklyDiscountPercent) || 0,
        energyFeePerDay: Number(formData.energyFeePerDay) || 0,
        additionalServicesFee: Number(formData.additionalServicesFee) || 0,
        rating: 0,
        reviews: 0,
        beds: Number(formData.beds) || 1,
        baths: Number(formData.baths) || 1,
        maxGuests: Number(formData.maxGuests) || 2,
        status: "active",
        occupancy: 0,
        monthlyRevenue: 0,
        bookingStatus: "available" as const,
        channels: updatedChannels,
        amenities: ["wifi"],
        ownerPayout: 0,
        staffPay: 0,
        autoAssignCleaner: formData.autoAssignCleaner,
        cleanerPriorities: formData.cleanerPriorities,
        bedConfiguration: formData.bedConfiguration,
        standardInstructions: formData.standardInstructions,
        evidenceCriteria: formData.evidenceCriteria,
        descriptionEN: formData.descriptionEN,
        descriptionES: formData.descriptionES,
        photoTour: formData.photoTour,
        amenitiesConfig: formData.amenitiesConfig,
        wifiSsid: formData.wifiSsid,
        wifiPassword: formData.wifiPassword,
        electricityEnabled: formData.electricityEnabled,
        electricityRate: Number(formData.electricityRate) || 0,
        checkInTime: formData.checkInTime,
        checkOutTime: formData.checkOutTime,
        ttlockLockId: formData.ttlockLockId,
      };
    }

    try {
      const res = await syncToSupabase(finalProp);
      if (res && res.ok) {
        if (editingProperty) {
          setProperties((prev) => prev.map((p) => (p.id === editingProperty.id ? finalProp : p)));
        } else {
          setProperties((prev) => [...prev, finalProp]);
        }
        setShowModal(false);

        // Auto-importar bookings/bloqueos si la propiedad tiene algún iCal
        // configurado. Sin esto, el usuario tenía que ir al tab Canales y
        // presionar "Sincronizar" manualmente — y aún así el calendario no
        // se refrescaba. Ahora basta con guardar.
        const hasIcal = !!(formData.airbnbIcal || formData.vrboIcal);
        if (!hasIcal) {
          toast.message("Sin iCal configurado — saltando sincronización.");
        } else {
          try {
            const importRes = await fetch("/api/ical/import", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({ propertyId: finalProp.id }),
            });
            const importData = await importRes.json().catch(() => null);
            if (!importRes.ok) {
              toast.error(
                `iCal HTTP ${importRes.status}: ${importData?.error ?? "error desconocido"}`
              );
            } else if (importData) {
              const reservas = importData.imported ?? 0;
              const bloqueos = importData.blocksImported ?? 0;
              const orphans = importData.orphansCancelled ?? 0;
              if (importData.errors?.length) {
                toast.error(
                  `iCal: ${importData.errors[0].message}` +
                  (importData.errors.length > 1 ? ` (+${importData.errors.length - 1} más)` : "")
                );
              } else {
                // Siempre damos feedback — incluso 0/0 te dice que el sync
                // corrió pero el feed no trajo nada (ej. URL inválida).
                toast.success(
                  `Sync OK: ${reservas} reservas, ${bloqueos} bloqueos` +
                  (orphans > 0 ? `, ${orphans} canceladas` : "")
                );
              }
              window.dispatchEvent(new CustomEvent("stayhost:bookings-updated"));
            } else {
              toast.error("iCal: respuesta vacía del servidor.");
            }
          } catch (icalErr) {
            console.error("auto ical import failed:", icalErr);
            toast.error(`iCal falló: ${icalErr instanceof Error ? icalErr.message : String(icalErr)}`);
          }
        }
      } else {
        toast.error("Error al sincronizar con el servidor. Por favor intenta de nuevo.");
      }
    } catch (err) {
      toast.error("Error de conexión. Verifica tu internet.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    setProperties((prev) => prev.filter((p) => p.id !== id));
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, { label: string; className: string }> = {
      active: { label: "Activa", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800" },
      maintenance: { label: "Mantenimiento", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800" },
      inactive: { label: "Inactiva", className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700" },
    };
    const config = map[status] || map.inactive;
    return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${config.className}`}>{config.label}</span>;
  };

  const getBookingBadge = (status: string) => {
    const map: Record<string, { label: string; className: string; dot: string }> = {
      occupied: { label: "Ocupada", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 border-red-200", dot: "bg-red-500" },
      available: { label: "Disponible", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200", dot: "bg-emerald-500" },
      checkout_today: { label: "Checkout Hoy", className: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 border-orange-200", dot: "bg-orange-500" },
      checkin_today: { label: "Check-in Hoy", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200", dot: "bg-blue-500" },
    };
    const config = map[status] || map.available;
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${config.className}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${config.dot} animate-pulse`} />
        {config.label}
      </span>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-6">
      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Mis Propiedades</h2>
          <p className="text-muted-foreground">Gestiona todas tus propiedades y sus canales de distribución</p>
        </div>
        <Button onClick={handleOpenAdd} className="gradient-gold text-primary-foreground gap-2">
          <Plus className="h-4 w-4" />
          Nueva Propiedad
        </Button>
      </div>

      {/* ─── Stats ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-primary/10">
              <Home className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-sm text-muted-foreground">Propiedades</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-emerald-500/10">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.active}</p>
              <p className="text-sm text-muted-foreground">Activas</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-blue-500/10">
              <TrendingUp className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.avgOccupancy}%</p>
              <p className="text-sm text-muted-foreground">Ocupación Prom.</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-amber-500/10">
              <DollarSign className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">${(stats.totalRevenue / 1000).toFixed(1)}k</p>
              <p className="text-sm text-muted-foreground">Ingresos / mes</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Toolbar ─────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre o ciudad..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 px-3 rounded-md border border-input bg-background text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">Todos los estados</option>
            <option value="active">Activas</option>
            <option value="maintenance">Mantenimiento</option>
            <option value="inactive">Inactivas</option>
          </select>
          <div className="flex border rounded-md overflow-hidden">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-2.5 transition-colors ${viewMode === "grid" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-2.5 transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </CardContent>
      </Card>

      {/* ─── Content ─────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Home className="h-16 w-16 mx-auto text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold mb-1">No se encontraron propiedades</h3>
            <p className="text-muted-foreground text-sm">Ajusta los filtros o agrega una nueva propiedad.</p>
          </CardContent>
        </Card>
      ) : viewMode === "grid" ? (
        /* ─── GRID VIEW ─────────────────────────────────────────────────── */
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map((prop) => (
            <Card key={prop.id} className="overflow-hidden hover:shadow-elevated transition-all duration-300 group cursor-pointer" onClick={() => setSelectedProperty(prop)}>
              {/* Image */}
              <div className="relative h-48 overflow-hidden">
                <img
                  src={prop.image}
                  alt={prop.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                <div className="absolute top-3 left-3 flex gap-2">
                  {getStatusBadge(prop.status)}
                  {getBookingBadge(prop.bookingStatus)}
                </div>
                <div className="absolute top-3 right-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="secondary" size="icon" className="h-8 w-8 bg-white/90 hover:bg-white">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); handleOpenEdit(prop); }}>
                        <Edit3 className="h-4 w-4 mr-2" /> Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Calendar className="h-4 w-4 mr-2" /> Ver Calendario
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Link2 className="h-4 w-4 mr-2" /> Conectar Canales
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive" onClick={(e) => { e.stopPropagation(); handleDelete(prop.id); }}>
                        <Trash2 className="h-4 w-4 mr-2" /> Eliminar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {/* Bottom overlay info */}
                <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between">
                  <div>
                    <h3 className="font-bold text-white text-lg leading-tight drop-shadow-md">{prop.name}</h3>
                    <div className="flex items-center gap-1 text-white/80 text-sm">
                      <MapPin className="h-3 w-3" />
                      {prop.city}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 bg-black/40 backdrop-blur-sm px-2 py-1 rounded-lg">
                    <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
                    <span className="text-white text-sm font-bold">{prop.rating}</span>
                    <span className="text-white/60 text-xs">({prop.reviews})</span>
                  </div>
                </div>
              </div>

              <CardContent className="p-4">
                {/* Channels */}
                <div className="flex items-center gap-1.5 mb-3">
                  {prop.channels.map((ch) => (
                    ch.connected && ch.listingUrl ? (
                      <a
                        key={ch.name}
                        href={ch.listingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`${ch.name}: Ver anuncio ↗`}
                        onClick={(e) => e.stopPropagation()}
                        className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold ${ch.color} text-white shadow-sm hover:scale-110 hover:shadow-md transition-all cursor-pointer`}
                      >
                        {ch.icon}
                      </a>
                    ) : (
                      <span
                        key={ch.name}
                        title={`${ch.name}: ${ch.connected ? "Conectado" : "No conectado"}`}
                        className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold transition-all ${ch.connected
                            ? `${ch.color} text-white shadow-sm`
                            : "bg-muted text-muted-foreground/40"
                          }`}
                      >
                        {ch.icon}
                      </span>
                    )
                  ))}
                  <span className="text-xs text-muted-foreground ml-1">
                    {prop.channels.filter((c) => c.connected).length}/{prop.channels.length}
                  </span>
                </div>
                {/* iCal Sync Status */}
                {prop.channels.some(c => c.icalUrl) && (
                  <div className="flex items-center gap-1.5 mb-3 px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                      iCal: {prop.channels.filter(c => c.icalUrl).length} {prop.channels.filter(c => c.icalUrl).length === 1 ? 'calendario sincronizado' : 'calendarios sincronizados'}
                    </span>
                  </div>
                )}

                {/* Quick Stats */}
                <div className="flex items-center gap-4 mb-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1" title="Habitaciones">
                    <Bed className="h-4 w-4" /> {prop.beds}
                  </div>
                  <div className="flex items-center gap-1" title="Baños">
                    <Bath className="h-4 w-4" /> {prop.baths}
                  </div>
                  <div className="flex items-center gap-1" title="Huéspedes máx.">
                    <Users className="h-4 w-4" /> {prop.maxGuests}
                  </div>
                </div>

                {/* Occupancy Bar */}
                <div className="mb-4">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Ocupación</span>
                    <span className="font-semibold">{prop.occupancy}%</span>
                  </div>
                  <Progress value={prop.occupancy} className="h-1.5" />
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-3 border-t">
                  <div>
                    <span className="text-xl font-bold">${prop.price}</span>
                    <span className="text-muted-foreground text-sm"> /noche</span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-emerald-600">${(prop.monthlyRevenue / 1000).toFixed(1)}k</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">mes</p>
                  </div>
                </div>

                {/* Next Check-in Indicator */}
                {prop.nextCheckIn && (
                  <div className="mt-3 p-2.5 rounded-lg bg-primary/5 border border-primary/10 flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs">
                      <span className="font-semibold">{prop.nextCheckIn}</span>
                      <span className="text-muted-foreground"> — {prop.nextGuest}</span>
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        /* ─── LIST VIEW ─────────────────────────────────────────────────── */
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Propiedad</th>
                    <th className="text-left p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Canales</th>
                    <th className="text-left p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Precio</th>
                    <th className="text-left p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ocupación</th>
                    <th className="text-left p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ingresos/mes</th>
                    <th className="text-left p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Estado</th>
                    <th className="text-right p-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((prop) => (
                    <tr key={prop.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors group cursor-pointer" onClick={() => setSelectedProperty(prop)}>
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0">
                            <img src={prop.image} alt={prop.name} className="w-full h-full object-cover" />
                          </div>
                          <div>
                            <p className="font-semibold text-sm">{prop.name}</p>
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <MapPin className="h-3 w-3" /> {prop.city}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-1">
                          {prop.channels.map((ch) => (
                            <span
                              key={ch.name}
                              className={`w-6 h-6 rounded flex items-center justify-center text-[9px] font-bold ${ch.connected ? `${ch.color} text-white` : "bg-muted text-muted-foreground/30"
                                }`}
                            >
                              {ch.icon}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="font-semibold">${prop.price}</span>
                        <span className="text-muted-foreground text-xs">/noche</span>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Progress value={prop.occupancy} className="h-1.5 w-16" />
                          <span className="text-sm font-medium">{prop.occupancy}%</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="font-semibold text-emerald-600">${prop.monthlyRevenue.toLocaleString()}</span>
                      </td>
                      <td className="p-4">{getStatusBadge(prop.status)}</td>
                      <td className="p-4">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={(e) => { e.stopPropagation(); handleOpenEdit(prop); }} className="p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground">
                            <Edit3 className="h-4 w-4" />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleDelete(prop.id); }} className="p-2 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors text-red-500">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Detail Drawer ───────────────────────────────────────────────── */}
      {selectedProperty && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setSelectedProperty(null)} />
          <div className="relative w-full max-w-lg bg-background shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-300">
            {/* Header Image */}
            <div className="relative h-56">
              <img src={selectedProperty.image} alt={selectedProperty.name} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
              <button onClick={() => setSelectedProperty(null)} className="absolute top-4 right-4 p-2 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors">
                <X className="h-5 w-5" />
              </button>
              <div className="absolute bottom-4 left-4 right-4">
                <div className="flex items-center gap-2 mb-1">{getStatusBadge(selectedProperty.status)}</div>
                <h2 className="text-xl font-bold text-white">{selectedProperty.name}</h2>
                <div className="flex items-center gap-1 text-white/80 text-sm mt-1">
                  <MapPin className="h-3 w-3" /> {selectedProperty.address}, {selectedProperty.city}
                </div>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Quick Stats */}
              <div className="grid grid-cols-4 gap-3">
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <Bed className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                  <p className="font-bold">{selectedProperty.beds}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">Camas</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <Bath className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                  <p className="font-bold">{selectedProperty.baths}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">Baños</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <Users className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                  <p className="font-bold">{selectedProperty.maxGuests}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">Huéspedes</p>
                </div>
                <div className="text-center p-3 rounded-lg bg-muted/50">
                  <Star className="h-4 w-4 mx-auto mb-1 text-amber-500 fill-amber-500" />
                  <p className="font-bold">{selectedProperty.rating}</p>
                  <p className="text-[10px] text-muted-foreground uppercase">{selectedProperty.reviews} reviews</p>
                </div>
              </div>

              {/* Channels */}
              <div>
                <h4 className="text-sm font-semibold mb-3">Canales de Distribución</h4>
                <div className="space-y-2">
                  {selectedProperty.channels.map((ch) => (
                    <div key={ch.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-3">
                        <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${ch.connected ? `${ch.color} text-white` : "bg-muted text-muted-foreground/40"}`}>
                          {ch.icon}
                        </span>
                        <span className="font-medium text-sm">{ch.name}</span>
                      </div>
                      <Badge variant={ch.connected ? "default" : "secondary"} className={ch.connected ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : ""}>
                        {ch.connected ? "Conectado" : "Sin conectar"}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>

              {/* Financials */}
              <div>
                <h4 className="text-sm font-semibold mb-3">Resumen Financiero</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-4 rounded-lg border bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800">
                    <p className="text-xs text-muted-foreground mb-1">Ingreso Mensual</p>
                    <p className="text-xl font-bold text-emerald-600">${selectedProperty.monthlyRevenue.toLocaleString()}</p>
                  </div>
                  <div className="p-4 rounded-lg border">
                    <p className="text-xs text-muted-foreground mb-1">Precio/Noche</p>
                    <p className="text-xl font-bold">${selectedProperty.price}</p>
                  </div>
                  <div className="p-4 rounded-lg border">
                    <p className="text-xs text-muted-foreground mb-1">Pago Propietario</p>
                    <p className="text-lg font-bold">${selectedProperty.ownerPayout.toLocaleString()}</p>
                  </div>
                  <div className="p-4 rounded-lg border">
                    <p className="text-xs text-muted-foreground mb-1">Pago Staff</p>
                    <p className="text-lg font-bold">${selectedProperty.staffPay}</p>
                  </div>
                </div>
              </div>

              {/* Occupancy */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold">Ocupación</h4>
                  <span className="text-lg font-bold">{selectedProperty.occupancy}%</span>
                </div>
                <Progress value={selectedProperty.occupancy} className="h-2" />
              </div>

              {/* Next Check-in */}
              {selectedProperty.nextCheckIn && (
                <div className="p-4 rounded-lg bg-primary/5 border border-primary/10">
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-primary" /> Próximo Check-in
                  </h4>
                  <p className="font-medium">{selectedProperty.nextGuest}</p>
                  <p className="text-sm text-muted-foreground">{selectedProperty.nextCheckIn}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <Button onClick={() => { setSelectedProperty(null); handleOpenEdit(selectedProperty); }} variant="outline" className="flex-1 gap-2">
                  <Edit3 className="h-4 w-4" /> Editar
                </Button>
                <Button className="flex-1 gap-2 gradient-gold text-primary-foreground">
                  <Calendar className="h-4 w-4" /> Ver Calendario
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal: Add/Edit Property ────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative w-full max-w-lg bg-background rounded-2xl shadow-2xl border overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 pb-4 bg-gradient-to-r from-primary/5 via-primary/10 to-transparent border-b">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold">{editingProperty ? "Editar Propiedad" : "Nueva Propiedad"}</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {editingProperty ? "Actualiza la información de la propiedad" : "Agrega una nueva propiedad a tu portfolio"}
                  </p>
                </div>
                <button onClick={() => setShowModal(false)} className="p-2 rounded-lg hover:bg-muted transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Tabs */}
            {creationStep === "form" && (
            <div className="flex border-b px-6 gap-1 overflow-x-auto scroolbar-hide">
              <button onClick={() => setModalTab("propiedad")} className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${modalTab === "propiedad" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}><Home className="h-3.5 w-3.5" />Básicos</button>
              <button onClick={() => setModalTab("photo-tour")} className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${modalTab === "photo-tour" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}><Camera className="h-3.5 w-3.5" />Photo Tour</button>
              <button onClick={() => setModalTab("amenidades")} className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${modalTab === "amenidades" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}><Sparkles className="h-3.5 w-3.5" />Amenidades</button>
              <button onClick={() => setModalTab("comercial")} className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${modalTab === "comercial" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}><DollarSign className="h-3.5 w-3.5" />Comercial</button>
              <button onClick={() => setModalTab("operativa")} className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${modalTab === "operativa" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}><ClipboardList className="h-3.5 w-3.5" />Operativa</button>
              <button onClick={() => setModalTab("dispositivos")} className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${modalTab === "dispositivos" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}><Settings className="h-3.5 w-3.5" />Dispositivos</button>
            </div>
            )}

            <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
              {creationStep === "options" ? (
                <div className="flex flex-col gap-4 py-4">
                  <button onClick={() => setCreationStep("airbnb-import")} className="w-full relative group overflow-hidden rounded-2xl border-2 border-primary/20 bg-gradient-to-br from-primary/5 via-primary/10 to-transparent p-6 text-left hover:border-primary/50 transition-all hover:shadow-lg">
                    <div className="absolute top-4 right-4">
                      <Badge className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1 font-bold">
                        <Crown className="h-3 w-3" fill="currentColor" /> PRO
                      </Badge>
                    </div>
                    <div className="flex gap-4 items-start">
                      <div className="bg-white p-3 rounded-xl shadow-sm inline-flex shrink-0">
                        <svg viewBox="0 0 448 512" fill="#FF5A5F" className="h-8 w-8">
                          <path d="M224 373.1c-25.2-31.7-40.1-59.4-45-83.2-22.6-88 18.5-126.5 45-126.5s67.6 38.5 45 126.5c-4.9 23.8-19.8 51.5-45 83.2zm212.6-144.3c-1.3-4.1-38.3-120.3-125.7-93.5-16.1 4.9-31.5 13.9-45.6 26.6-4.5-8.4-10.7-18.4-18.9-29.2-20.7-27.1-50.6-45.7-86.8-45.7-34.9 0-64.8 17.6-86.4 44.5C21 198.8 6.5 289.4 17.6 376c2.5 19.9 14.8 36.8 32.7 44.9 23.9 10.8 55.6 1.8 77.2-21.2 5.5-5.9 10.6-12.4 15.3-19.5-14.7-20.6-26.6-44.4-34.6-70.3-4.5-15-7.3-30.8-8-47.1-2.9-66.2 36-118.8 82.2-118.8 45.4 0 85.9 51.8 83 118.8-.7 16.3-3.5 32.1-8 47.1-8 25.9-19.9 49.7-34.6 70.3 4.7 7.1 9.8 13.6 15.3 19.5 21.6 23 53.3 32 77.2 21.2 17.9-8.1 30.2-25 32.7-44.9 8.4-66.1-9.9-146.9-22-143zm-278.4 87.2c7.6 19.7 18 38.6 30.8-55.7-16 11.2-32.9 20.3-50.3 26.8-14.6 5.4-31-1.3-37-15.6-4.4-10.4-3.5-22.3 2.5-31.9 10.1-16 28.1-27.4 49-31.2 1.7-.3 3.4-.6 5-.8zm178 82.5c12.8-17.1 23.2-36 30.8-55.7 1.6.2 3.3.5 5 .8 20.9 3.8 38.9 15.2 49 31.2 6 9.6 6.9 21.5 2.5 31.9-6 14.3-22.4 21-37 15.6-17.4-6.5-34.3-15.6-50.3-26.8z"/>
                        </svg>
                      </div>
                      <div className="flex-1">
                        <h4 className="text-base font-bold text-foreground group-hover:text-primary transition-colors">Importar desde Airbnb</h4>
                        <p className="text-xs text-muted-foreground mt-1">Conecta el link de tu anuncio en Airbnb y extraemos toda la info, descripciones, y fotos automáticamente en segundos.</p>
                      </div>
                    </div>
                  </button>

                  <button onClick={() => setCreationStep("form")} className="w-full rounded-2xl border bg-card p-6 text-left hover:bg-muted/50 transition-all hover:border-border/80">
                    <div className="flex gap-4 items-start">
                      <div className="bg-muted p-3 rounded-xl inline-flex shrink-0">
                        <Home className="h-8 w-8 text-muted-foreground" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-base font-bold text-foreground">Configuración Manual</h4>
                        <p className="text-xs text-muted-foreground mt-1">Llena todos los campos manualmente. Gratis e ideal si la propiedad no está en ninguna plataforma todavía.</p>
                      </div>
                    </div>
                  </button>
                </div>
              ) : creationStep === "airbnb-import" ? (
                <div className="flex flex-col gap-6 py-6 animate-in slide-in-from-right duration-300">
                  <div className="space-y-2">
                    <button onClick={() => setCreationStep("options")} className="text-xs font-medium text-primary hover:underline mb-2 px-1">
                      ← Volver a opciones
                    </button>
                    <h4 className="font-bold text-lg">Pega el enlace de Airbnb</h4>
                    <p className="text-sm text-muted-foreground">Copia y pega la URL pública de la propiedad (ej. www.airbnb.com/rooms/123...)</p>
                  </div>
                  <div className="flex flex-col gap-3">
                    <Input 
                      placeholder="https://www.airbnb.com/rooms/..." 
                      className="h-12 bg-muted/50" 
                      value={airbnbImportLink}
                      onChange={(e) => setAirbnbImportLink(e.target.value)}
                      disabled={isImporting}
                    />
                    <Button onClick={handleSimulateImport} disabled={!airbnbImportLink || isImporting} className="h-12 w-full gradient-gold text-primary-foreground font-bold">
                      {isImporting ? <RefreshCw className="h-5 w-5 animate-spin" /> : "Importar Mágicamente"}
                    </Button>
                  </div>
                  {isImporting && (
                    <div className="mt-4 space-y-3">
                      <div className="flex items-center justify-between text-xs font-medium text-primary">
                        <span>Extrayendo información mágicamente...</span>
                        <span className="animate-pulse">⏳</span>
                      </div>
                      <Progress value={undefined} className="h-1.5 animate-pulse bg-primary/20" />
                    </div>
                  )}
                </div>
              ) : modalTab === "propiedad" ? (
                <>
                  <div className="space-y-2">
                    <Label>Nombre de la propiedad</Label>
                    <Input placeholder="Ej: Villa Mar Azul" value={formData.name} onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Dirección</Label>
                    <Input placeholder="Calle, número, colonia" value={formData.address} onChange={(e) => setFormData((p) => ({ ...p, address: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Ciudad</Label>
                    <Input placeholder="Ej: Cancún, Quintana Roo" value={formData.city} onChange={(e) => setFormData((p) => ({ ...p, city: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>Tipo de propiedad</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {Object.entries(typeConfig).map(([key, config]) => (
                        <button key={key} onClick={() => setFormData((p) => ({ ...p, type: key as Property["type"] }))}
                          className={`flex items-center gap-2 p-2.5 rounded-lg border-2 text-sm font-medium transition-all ${formData.type === key ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}
                        >
                          {config.icon} {config.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Habitaciones</Label>
                      <Input type="number" placeholder="2" value={formData.beds} onChange={(e) => setFormData((p) => ({ ...p, beds: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Baños</Label>
                      <Input type="number" placeholder="1" value={formData.baths} onChange={(e) => setFormData((p) => ({ ...p, baths: e.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Huéspedes máx.</Label>
                      <Input type="number" placeholder="4" value={formData.maxGuests} onChange={(e) => setFormData((p) => ({ ...p, maxGuests: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-4 pt-4 border-t mt-4">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      <Globe className="h-4 w-4 text-primary" /> Descripciones Públicas (i18n)
                    </h4>
                    <p className="text-xs text-muted-foreground">Configura los textos que los turistas verán en la página de reservas directas.</p>
                    
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center text-[10px] font-bold text-blue-800">ES</span>
                          Descripción en Español
                        </Label>
                      </div>
                      <Textarea 
                        placeholder="Describe las virtudes de la propiedad. Ej: Hermosa villa frente al mar ideal para familias..." 
                        rows={3} 
                        value={formData.descriptionES} 
                        onChange={(e) => setFormData(p => ({ ...p, descriptionES: e.target.value }))}
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-rose-100 flex items-center justify-center text-[10px] font-bold text-rose-800">EN</span>
                          Descripción en Inglés
                        </Label>
                      </div>
                      <Textarea 
                        placeholder="Describe the property highlights. Ex: Beautiful beachfront villa ideal for families..." 
                        rows={3} 
                        value={formData.descriptionEN} 
                        onChange={(e) => setFormData(p => ({ ...p, descriptionEN: e.target.value }))}
                      />
                    </div>
                  </div>
                </>
              ) : modalTab === "photo-tour" ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-semibold flex items-center gap-2">
                        <Camera className="h-4 w-4 text-primary" /> Recorrido Fotográfico (Photo Tour)
                      </h4>
                      <p className="text-xs text-muted-foreground mt-0.5">Organiza las fotos por espacios para que el huésped entienda mejor la propiedad.</p>
                    </div>
                    <Button 
                      type="button" 
                      variant="outline" 
                      size="sm" 
                      onClick={() => {
                        const newRoom: PhotoTourRoom = {
                          id: Math.random().toString(36).substr(2, 9),
                          name: "Nuevo Espacio",
                          type: "other",
                          images: []
                        };
                        setFormData(p => ({ ...p, photoTour: [...(p.photoTour || []), newRoom] }));
                      }}
                      className="gap-2"
                    >
                      <Plus className="h-3.5 w-3.5" /> Agregar Espacio
                    </Button>
                  </div>

                  {(!formData.photoTour || formData.photoTour.length === 0) ? (
                    <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed rounded-2xl bg-muted/20">
                      <div className="bg-muted p-4 rounded-full mb-3">
                        <ImagePlus className="h-8 w-8 text-muted-foreground" />
                      </div>
                      <p className="text-sm font-medium">No hay espacios configurados</p>
                      <p className="text-xs text-muted-foreground max-w-[240px] text-center mt-1">Crea espacios como "Dormitorio", "Cocina" o "Exterior" y añade fotos a cada uno.</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {formData.photoTour.map((space, spaceIdx) => (
                        <div key={space.id} className="p-5 rounded-2xl border bg-card/50 relative group">
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                              <div className="bg-primary/10 p-2 rounded-lg">
                                <Home className="h-4 w-4 text-primary" />
                              </div>
                              <div className="flex flex-col">
                                <Input 
                                  value={space.name} 
                                  onChange={(e) => {
                                    const newPhotoTour = [...formData.photoTour];
                                    newPhotoTour[spaceIdx].name = e.target.value;
                                    setFormData(p => ({ ...p, photoTour: newPhotoTour }));
                                  }}
                                  className="h-8 text-sm font-semibold border-transparent hover:border-input focus:border-input bg-transparent px-1 -ml-1 transition-all w-48"
                                />
                                <select 
                                  value={space.type}
                                  onChange={(e) => {
                                    const newPhotoTour = [...formData.photoTour];
                                    newPhotoTour[spaceIdx].type = e.target.value as any;
                                    setFormData(p => ({ ...p, photoTour: newPhotoTour }));
                                  }}
                                  className="text-[10px] uppercase font-bold text-muted-foreground bg-transparent border-none outline-none cursor-pointer"
                                >
                                  <option value="bedroom">Dormitorio</option>
                                  <option value="bathroom">Baño</option>
                                  <option value="kitchen">Cocina</option>
                                  <option value="living">Sala</option>
                                  <option value="outdoor">Exterior</option>
                                  <option value="other">Otro</option>
                                </select>
                              </div>
                            </div>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => {
                                setFormData(p => ({ ...p, photoTour: p.photoTour.filter((_, i) => i !== spaceIdx) }));
                              }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                            {space.images.map((photo, photoIdx) => (
                              <div key={photoIdx} className="aspect-square rounded-xl bg-muted relative group/photo overflow-hidden border">
                                <img src={photo} alt="" className="w-full h-full object-cover" />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/photo:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                  <button onClick={() => {
                                    const newPhotoTour = [...formData.photoTour];
                                    newPhotoTour[spaceIdx].images = newPhotoTour[spaceIdx].images.filter((_, i) => i !== photoIdx);
                                    setFormData(p => ({ ...p, photoTour: newPhotoTour }));
                                  }} className="bg-red-500 text-white p-1.5 rounded-lg hover:bg-red-600 transition-colors">
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                            <button 
                              onClick={() => {
                                const url = prompt("Introduce la URL de la imagen:");
                                if (url) {
                                  const newPhotoTour = [...formData.photoTour];
                                  newPhotoTour[spaceIdx].images = [...newPhotoTour[spaceIdx].images, url];
                                  setFormData(p => ({ ...p, photoTour: newPhotoTour }));
                                }
                              }}
                              className="aspect-square rounded-xl border-2 border-dashed border-muted-foreground/20 hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-2 text-muted-foreground active:scale-95"
                            >
                              <Plus className="h-5 w-5" />
                              <span className="text-[10px] font-medium">Añadir foto</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : modalTab === "amenidades" ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" /> Servicios y Amenidades
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">Selecciona todos los servicios que ofreces en tu propiedad.</p>
                  </div>

                  <div className="grid gap-8">
                    {/* Amenidades Populares */}
                    <div className="space-y-4">
                      <h5 className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-2">
                        <div className="h-1 w-1 rounded-full bg-primary" /> Destacados
                      </h5>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {[
                          { id: 'wifi', name: 'Wifi', icon: '📶' },
                          { id: 'kitchen', name: 'Cocina', icon: '🍳' },
                          { id: 'ac', name: 'Aire acondicionado', icon: '❄️' },
                          { id: 'parking', name: 'Parking', icon: '🚗' },
                          { id: 'pool', name: 'Piscina', icon: '🏊' },
                          { id: 'workspace', name: 'Espacio de trabajo', icon: '💻' },
                          { id: 'tv', name: 'TV', icon: '📺' },
                        ].map((amenity) => (
                          <div key={amenity.id} className="flex items-start gap-3 p-3 rounded-xl border bg-card/50 hover:bg-muted/30 transition-colors cursor-pointer" 
                            onClick={() => {
                              const isSelected = formData.amenitiesConfig.popular.includes(amenity.id);
                              setFormData(p => ({ 
                                ...p, 
                                amenitiesConfig: { 
                                  ...p.amenitiesConfig, 
                                  popular: isSelected 
                                    ? p.amenitiesConfig.popular.filter(id => id !== amenity.id)
                                    : [...p.amenitiesConfig.popular, amenity.id]
                                } 
                              }));
                            }}>
                            <Checkbox 
                              checked={formData.amenitiesConfig.popular.includes(amenity.id)} 
                              className="mt-1"
                            />
                            <div className="space-y-1">
                              <span className="text-sm font-medium flex items-center gap-2">
                                <span className="text-base">{amenity.icon}</span>
                                {amenity.name}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Baño */}
                    <div className="space-y-4">
                      <h5 className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-2">
                        <div className="h-1 w-1 rounded-full bg-primary" /> Baño
                      </h5>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {[
                          { id: 'hotWater', name: 'Agua caliente' },
                          { id: 'hairDryer', name: 'Secadora de pelo' },
                          { id: 'shampoo', name: 'Shampoo' },
                        ].map((item) => (
                          <label key={item.id} className="flex items-center gap-2.5 text-sm cursor-pointer p-2 rounded-lg hover:bg-muted/50">
                            <Checkbox 
                              checked={formData.amenitiesConfig.bathroom.includes(item.id)}
                              onCheckedChange={(checked) => {
                                setFormData(p => ({
                                  ...p,
                                  amenitiesConfig: {
                                    ...p.amenitiesConfig,
                                    bathroom: checked 
                                      ? [...p.amenitiesConfig.bathroom, item.id]
                                      : p.amenitiesConfig.bathroom.filter(id => id !== item.id)
                                  }
                                }));
                              }}
                            />
                            {item.name}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Dormitorio */}
                    <div className="space-y-4">
                      <h5 className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-2">
                        <div className="h-1 w-1 rounded-full bg-primary" /> Dormitorio y Lavandería
                      </h5>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {[
                          { id: 'washer', name: 'Lavadora' },
                          { id: 'dryer', name: 'Secadora' },
                          { id: 'essentials', name: 'Esenciales (Toallas/Sábanas)' },
                          { id: 'hangers', name: 'Ganchos' },
                          { id: 'iron', name: 'Plancha' },
                        ].map((item) => (
                          <label key={item.id} className="flex items-center gap-2.5 text-sm cursor-pointer p-2 rounded-lg hover:bg-muted/50">
                            <Checkbox 
                              checked={formData.amenitiesConfig.bedroom.includes(item.id)}
                              onCheckedChange={(checked) => {
                                setFormData(p => ({
                                  ...p,
                                  amenitiesConfig: {
                                    ...p.amenitiesConfig,
                                    bedroom: checked 
                                      ? [...p.amenitiesConfig.bedroom, item.id]
                                      : p.amenitiesConfig.bedroom.filter(id => id !== item.id)
                                  }
                                }));
                              }}
                            />
                            {item.name}
                          </label>
                        ))}
                      </div>
                    </div>
                    {/* Cocina */}
                    <div className="space-y-4">
                      <h5 className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-2">
                        <div className="h-1 w-1 rounded-full bg-primary" /> Cocina y Comedor
                      </h5>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {[
                          { id: 'refrigerator', name: 'Refrigerador' },
                          { id: 'microwave', name: 'Microondas' },
                          { id: 'dishes', name: 'Vajilla y cubiertos' },
                          { id: 'stove', name: 'Estufa' },
                          { id: 'coffeeMaker', name: 'Cafetera' },
                        ].map((item) => (
                          <label key={item.id} className="flex items-center gap-2.5 text-sm cursor-pointer p-2 rounded-lg hover:bg-muted/50">
                            <Checkbox 
                              checked={formData.amenitiesConfig.kitchen.includes(item.id)}
                              onCheckedChange={(checked) => {
                                setFormData(p => ({
                                  ...p,
                                  amenitiesConfig: {
                                    ...p.amenitiesConfig,
                                    kitchen: checked 
                                      ? [...p.amenitiesConfig.kitchen, item.id]
                                      : p.amenitiesConfig.kitchen.filter(id => id !== item.id)
                                  }
                                }));
                              }}
                            />
                            {item.name}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Exterior */}
                    <div className="space-y-4">
                      <h5 className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground flex items-center gap-2">
                        <div className="h-1 w-1 rounded-full bg-primary" /> Exterior
                      </h5>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {[
                          { id: 'patio', name: 'Patio o balcón' },
                          { id: 'grill', name: 'Asador/Grill' },
                          { id: 'outdoorFurniture', name: 'Muebles de exterior' },
                          { id: 'beachfront', name: 'Frente al mar' },
                        ].map((item) => (
                          <label key={item.id} className="flex items-center gap-2.5 text-sm cursor-pointer p-2 rounded-lg hover:bg-muted/50">
                            <Checkbox 
                              checked={formData.amenitiesConfig.outdoor.includes(item.id)}
                              onCheckedChange={(checked) => {
                                setFormData(p => ({
                                  ...p,
                                  amenitiesConfig: {
                                    ...p.amenitiesConfig,
                                    outdoor: checked 
                                      ? [...p.amenitiesConfig.outdoor, item.id]
                                      : p.amenitiesConfig.outdoor.filter(id => id !== item.id)
                                  }
                                }));
                              }}
                            />
                            {item.name}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : modalTab === "comercial" ? (
                <div className="space-y-6">
                  {/* ── Tarifas ─────────────────────────────────────────────── */}
                  <div>
                    <h4 className="text-sm font-semibold flex items-center gap-2 mb-1">
                      <DollarSign className="h-4 w-4 text-primary" /> Tarifas
                    </h4>
                    <p className="text-xs text-muted-foreground mb-4">Configura las tarifas y descuentos para reservas ingresadas manualmente.</p>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Tarifa base por noche (USD)</Label>
                          <Input type="number" placeholder="Ej: 150" value={formData.price} onChange={(e) => setFormData((p) => ({ ...p, price: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>Descuento Semanal (%)</Label>
                          <Input type="number" placeholder="Ej: 10" value={formData.weeklyDiscountPercent} onChange={(e) => setFormData((p) => ({ ...p, weeklyDiscountPercent: e.target.value }))} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Tarifa limpieza 1 noche</Label>
                          <Input type="number" placeholder="Ej: 30" value={formData.cleaningFeeOneDay} onChange={(e) => setFormData((p) => ({ ...p, cleaningFeeOneDay: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>Tarifa limpieza +1 noche</Label>
                          <Input type="number" placeholder="Ej: 50" value={formData.cleaningFeeMoreDays} onChange={(e) => setFormData((p) => ({ ...p, cleaningFeeMoreDays: e.target.value }))} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Tarifa energía (Por noche)</Label>
                          <Input type="number" placeholder="Ej: 15" value={formData.energyFeePerDay} onChange={(e) => setFormData((p) => ({ ...p, energyFeePerDay: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>Servicios Extra (Por estadía)</Label>
                          <Input type="number" placeholder="Ej: 20" value={formData.additionalServicesFee} onChange={(e) => setFormData((p) => ({ ...p, additionalServicesFee: e.target.value }))} />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ── Canales ──────────────────────────────────────────────── */}
                  <div className="border-t pt-5">
                    <h4 className="text-sm font-semibold flex items-center gap-2 mb-1">
                      <Link2 className="h-4 w-4 text-primary" /> Canales de Distribución
                    </h4>
                    <p className="text-xs text-muted-foreground mb-4">Conecta la propiedad con las plataformas de reserva y sincroniza calendarios vía iCal.</p>
                    <div className="space-y-3">
                      <div className="p-4 rounded-xl border-2 border-rose-200 dark:border-rose-800/50 bg-rose-50/50 dark:bg-rose-900/10 space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="w-7 h-7 rounded-lg bg-rose-500 text-white flex items-center justify-center text-xs font-bold">A</span>
                          <span className="font-semibold">Airbnb</span>
                          {formData.airbnbUrl && <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">Conectado</Badge>}
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">URL del anuncio</Label>
                          <Input placeholder="https://www.airbnb.com/rooms/12345678" value={formData.airbnbUrl} onChange={(e) => setFormData((p) => ({ ...p, airbnbUrl: e.target.value }))} className="text-xs" />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">Enlace iCal</Label>
                          <Input placeholder="https://www.airbnb.com/calendar/ical/12345678.ics" value={formData.airbnbIcal} onChange={(e) => setFormData((p) => ({ ...p, airbnbIcal: e.target.value }))} className="text-xs" />
                        </div>
                        <SyncBar channelName="Airbnb" icalUrl={formData.airbnbIcal} />
                      </div>
                      <div className="p-4 rounded-xl border-2 border-blue-200 dark:border-blue-800/50 bg-blue-50/50 dark:bg-blue-900/10 space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center text-xs font-bold">B</span>
                          <span className="font-semibold">Booking.com</span>
                          {formData.bookingUrl && <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">Conectado</Badge>}
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">URL del anuncio</Label>
                          <Input placeholder="https://www.booking.com/hotel/..." value={formData.bookingUrl} onChange={(e) => setFormData((p) => ({ ...p, bookingUrl: e.target.value }))} className="text-xs" />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">Enlace iCal</Label>
                          <Input placeholder="https://admin.booking.com/export/calendar/..." value={formData.bookingIcal} onChange={(e) => setFormData((p) => ({ ...p, bookingIcal: e.target.value }))} className="text-xs" />
                        </div>
                        <SyncBar channelName="Booking" icalUrl={formData.bookingIcal} />
                      </div>
                      <div className="p-4 rounded-xl border-2 border-indigo-200 dark:border-indigo-800/50 bg-indigo-50/50 dark:bg-indigo-900/10 space-y-3">
                        <div className="flex items-center gap-2">
                          <span className="w-7 h-7 rounded-lg bg-indigo-500 text-white flex items-center justify-center text-xs font-bold">V</span>
                          <span className="font-semibold">VRBO</span>
                          {formData.vrboUrl && <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">Conectado</Badge>}
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">URL del anuncio</Label>
                          <Input placeholder="https://www.vrbo.com/..." value={formData.vrboUrl} onChange={(e) => setFormData((p) => ({ ...p, vrboUrl: e.target.value }))} className="text-xs" />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs">Enlace iCal</Label>
                          <Input placeholder="https://www.vrbo.com/icalendar/..." value={formData.vrboIcal} onChange={(e) => setFormData((p) => ({ ...p, vrboIcal: e.target.value }))} className="text-xs" />
                        </div>
                        <SyncBar channelName="VRBO" icalUrl={formData.vrboIcal} />
                      </div>

                      {/* ── Sincronización Externa (Estándar iGMS) ──────────────── */}
                      {editingProperty?.id && (
                        <div className="p-5 rounded-2xl border-2 border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/30 dark:bg-emerald-900/10 space-y-4">
                          <div className="flex items-center gap-2">
                            <CalendarRange className="h-5 w-5 text-emerald-600" />
                            <h4 className="font-bold text-sm text-emerald-900 dark:text-emerald-100">Exportación iCal (Estándar iGMS)</h4>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            Usa estos enlaces para sincronizar StayHost con Google Calendar, Airbnb o VRBO. Los eventos están optimizados con toda la información necesaria.
                          </p>
                          
                          <div className="space-y-4">
                            {/* Reservas [B] */}
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <Label className="text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                                  <span className="w-4 h-4 rounded bg-emerald-600 text-white flex items-center justify-center text-[8px]">B</span>
                                  Calendario de Reservas
                                </Label>
                                <Badge variant="outline" className="text-[9px] border-emerald-200 text-emerald-600 font-medium">Recomendado</Badge>
                              </div>
                              <div className="flex gap-2">
                                <Input 
                                  readOnly 
                                  value={`${typeof window !== "undefined" ? window.location.origin : ""}/api/ical/export?id=${editingProperty.id}&type=bookings`}
                                  className="text-xs bg-white dark:bg-background border-emerald-200 font-mono h-9"
                                  onClick={(e) => (e.target as HTMLInputElement).select()}
                                />
                                <Button 
                                  type="button" 
                                  size="sm"
                                  className="gradient-gold text-primary-foreground h-9 px-3 gap-1.5 shrink-0"
                                  onClick={() => {
                                    const url = `${window.location.origin}/api/ical/export?id=${editingProperty.id}&type=bookings`;
                                    navigator.clipboard.writeText(url);
                                    toast.success("Enlace de Reservas copiado");
                                  }}
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                  <span className="text-xs">Copiar</span>
                                </Button>
                              </div>
                            </div>

                            {/* Limpiezas [C] */}
                            <div className="space-y-2 pt-2 border-t border-emerald-100 dark:border-emerald-800">
                              <div className="flex items-center justify-between">
                                <Label className="text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                                  <span className="w-4 h-4 rounded bg-amber-500 text-white flex items-center justify-center text-[8px]">C</span>
                                  Calendario de Limpiezas
                                </Label>
                              </div>
                              <div className="flex gap-2">
                                <Input 
                                  readOnly 
                                  value={`${typeof window !== "undefined" ? window.location.origin : ""}/api/ical/export?id=${editingProperty.id}&type=tasks`}
                                  className="text-xs bg-white dark:bg-background border-emerald-200 font-mono h-9"
                                  onClick={(e) => (e.target as HTMLInputElement).select()}
                                />
                                <Button 
                                  type="button" 
                                  size="sm"
                                  variant="outline"
                                  className="h-9 px-3 gap-1.5 shrink-0 border-emerald-200 hover:bg-emerald-50 text-emerald-700"
                                  onClick={() => {
                                    const url = `${window.location.origin}/api/ical/export?id=${editingProperty.id}&type=tasks`;
                                    navigator.clipboard.writeText(url);
                                    toast.success("Enlace de Limpiezas copiado");
                                  }}
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                  <span className="text-xs">Copiar</span>
                                </Button>
                              </div>
                            </div>
                          </div>

                          <div className="p-3 rounded-xl bg-amber-50/50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/50 flex gap-2.5">
                            <Info className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                            <p className="text-[10px] text-amber-800 dark:text-amber-300 leading-tight">
                              <strong>Tip:</strong> Agrega estos calendarios en tu Google Calendar para ver toda la operativa desde tu móvil sin entrar al dashboard.
                            </p>
                          </div>
                        </div>
                      )}

                      <div className={`p-4 rounded-xl border-2 space-y-3 transition-all ${formData.directaEnabled ? 'border-emerald-400 dark:border-emerald-600 bg-emerald-50/80 dark:bg-emerald-900/20' : 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/10'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold transition-all ${formData.directaEnabled ? 'bg-emerald-500 text-white' : 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400'}`}>D</span>
                            <span className="font-semibold">Reservas Directas</span>
                            {formData.directaEnabled && <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">Activo</Badge>}
                          </div>
                          <button type="button" title={formData.directaEnabled ? "Desactivar reservas directas" : "Activar reservas directas"}
                            onClick={() => setFormData(p => ({ ...p, directaEnabled: !p.directaEnabled }))}
                            className={`relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 ${formData.directaEnabled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${formData.directaEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                          </button>
                        </div>
                        {!formData.directaEnabled && (
                          <p className="text-xs text-muted-foreground">Activa este canal si aceptas reservas directas (WhatsApp, teléfono, tu propia web, etc.)</p>
                        )}
                        {formData.directaEnabled && (
                          <div className="p-3 rounded-lg bg-emerald-100/60 dark:bg-emerald-900/30 border border-emerald-200/60 dark:border-emerald-800/40">
                            <div className="flex items-start gap-2">
                              <span className="text-emerald-600 mt-0.5">📤</span>
                              <div className="space-y-1.5">
                                <p className="text-xs font-medium text-emerald-800 dark:text-emerald-200">Canal Directo Activo</p>
                                <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80 leading-relaxed">
                                  StayHost gestionará tus reservas manuales y las incluirá en el feed iCal de exportación configurado arriba.
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : modalTab === "operativa" ? (
                <div className="space-y-6">
                  {/* ── Asignación Automática ────────────────────────────────── */}
                  <div>
                    <h4 className="text-sm font-semibold flex items-center gap-2 mb-3">
                      <Bot className="h-4 w-4 text-emerald-600" /> Asignación Automática
                    </h4>
                    <div className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${formData.autoAssignCleaner ? "bg-emerald-50 border-emerald-200" : "bg-muted/30 border-muted"}`}>
                      <div className="flex items-center gap-3">
                        <div className={`p-2.5 rounded-xl ${formData.autoAssignCleaner ? "bg-emerald-100" : "bg-muted"}`}>
                          <Bot className={`h-5 w-5 ${formData.autoAssignCleaner ? "text-emerald-600" : "text-muted-foreground"}`} />
                        </div>
                        <div>
                          <p className={`font-semibold text-sm ${formData.autoAssignCleaner ? "text-emerald-800" : "text-foreground"}`}>Asignar automáticamente</p>
                          <p className={`text-xs mt-0.5 ${formData.autoAssignCleaner ? "text-emerald-600" : "text-muted-foreground"}`}>Asigna limpiadores por orden de prioridad al crear una tarea</p>
                        </div>
                      </div>
                      <button type="button" title={formData.autoAssignCleaner ? "Desactivar" : "Activar"}
                        onClick={() => setFormData(prev => ({ ...prev, autoAssignCleaner: !prev.autoAssignCleaner }))}
                        className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 ${formData.autoAssignCleaner ? "bg-emerald-500" : "bg-gray-300"}`}>
                        <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${formData.autoAssignCleaner ? "translate-x-6" : "translate-x-0"}`} />
                      </button>
                    </div>
                    {formData.autoAssignCleaner && (
                      <div className="mt-4 space-y-4">
                        <div>
                          <h5 className="text-xs font-bold uppercase text-muted-foreground mb-2 tracking-wider flex items-center gap-1.5"><Star className="h-3.5 w-3.5 text-amber-500" /> Orden de Prioridad</h5>
                          {formData.cleanerPriorities.length === 0 ? (
                            <div className="p-5 text-center text-sm text-muted-foreground bg-muted/20 rounded-xl border-2 border-dashed">
                              Agrega limpiadores desde la sección de abajo para definir el orden
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {formData.cleanerPriorities.map((cleanerId, idx) => {
                                const cleaner = availableCleaners.find(c => c.id === cleanerId);
                                if (!cleaner) return null;
                                return (
                                  <div key={cleanerId} className="flex items-center gap-3 p-3 bg-white rounded-xl border shadow-sm">
                                    <span className="w-7 h-7 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold flex items-center justify-center border border-emerald-200 flex-shrink-0">{idx + 1}</span>
                                    <Avatar className="h-8 w-8">
                                      <AvatarImage src={cleaner.avatar} />
                                      <AvatarFallback className="text-xs">{cleaner.name.charAt(0)}</AvatarFallback>
                                    </Avatar>
                                    <span className="flex-1 text-sm font-medium">{cleaner.name}</span>
                                    <div className="flex items-center gap-1">
                                      <button type="button" title="Subir prioridad" disabled={idx === 0}
                                        onClick={() => { const arr = [...formData.cleanerPriorities]; [arr[idx-1],arr[idx]]=[arr[idx],arr[idx-1]]; setFormData(prev => ({...prev, cleanerPriorities: arr})); }}
                                        className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"><ChevronUp className="h-4 w-4" /></button>
                                      <button type="button" title="Bajar prioridad" disabled={idx === formData.cleanerPriorities.length - 1}
                                        onClick={() => { const arr = [...formData.cleanerPriorities]; [arr[idx+1],arr[idx]]=[arr[idx],arr[idx+1]]; setFormData(prev => ({...prev, cleanerPriorities: arr})); }}
                                        className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"><ChevronDown className="h-4 w-4" /></button>
                                      <button type="button" title="Quitar de la lista"
                                        onClick={() => setFormData(prev => ({...prev, cleanerPriorities: prev.cleanerPriorities.filter(id => id !== cleanerId)}))}
                                        className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-rose-50 hover:text-rose-500 transition-colors"><X className="h-3.5 w-3.5" /></button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        {availableCleaners.filter(c => !formData.cleanerPriorities.includes(c.id)).length > 0 && (
                          <div>
                            <h5 className="text-xs font-bold uppercase text-muted-foreground mb-2 tracking-wider">Agregar a la lista</h5>
                            <div className="space-y-2">
                              {availableCleaners.filter(c => !formData.cleanerPriorities.includes(c.id)).map(cleaner => (
                                <button key={cleaner.id} type="button"
                                  onClick={() => setFormData(prev => ({...prev, cleanerPriorities: [...prev.cleanerPriorities, cleaner.id]}))}
                                  className="w-full flex items-center gap-3 p-3 bg-muted/20 rounded-xl border border-dashed hover:bg-emerald-50 hover:border-emerald-300 transition-all text-left">
                                  <Avatar className="h-8 w-8"><AvatarImage src={cleaner.avatar} /><AvatarFallback className="text-xs">{cleaner.name.charAt(0)}</AvatarFallback></Avatar>
                                  <span className="flex-1 text-sm font-medium">{cleaner.name}</span>
                                  <Plus className="h-4 w-4 text-emerald-500" />
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        {availableCleaners.length === 0 && (
                          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex gap-3">
                            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                            <p className="text-xs text-amber-700">No hay limpiadores en el equipo. Ve a Equipo y agrega miembros con el rol Limpieza.</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── Insumos Recurrentes ──────────────────────────────────── */}
                  <div className="border-t pt-5 space-y-4">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      <Package className="h-4 w-4 text-primary" /> Insumos Recurrentes
                    </h4>
                    <p className="text-xs text-muted-foreground">Configura los insumos que el personal debe reponer según los días de estancia.</p>
                    {formData.recurringSupplies.map((rule, idx) => (
                      <div key={idx} className="p-4 rounded-xl border bg-muted/20 relative group">
                        <Button variant="ghost" size="icon" className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-white shadow-sm hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => setFormData(prev => ({ ...prev, recurringSupplies: prev.recurringSupplies.filter((_, i) => i !== idx) }))}>
                          <X className="h-3 w-3" />
                        </Button>
                        <div className="grid grid-cols-2 gap-4 mb-3">
                          <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Insumo</Label>
                            <Input value={rule.item} onChange={(e) => { const r = [...formData.recurringSupplies]; r[idx].item = e.target.value; setFormData(prev => ({...prev, recurringSupplies: r})); }} placeholder="Ej: Papel Higiénico" className="text-xs" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Cantidad</Label>
                            <Input type="number" value={rule.quantity} onChange={(e) => { const r = [...formData.recurringSupplies]; r[idx].quantity = Number(e.target.value); setFormData(prev => ({...prev, recurringSupplies: r})); }} placeholder="2" className="text-xs" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Estancia Mín. (Días)</Label>
                            <Input type="number" value={rule.minDays} onChange={(e) => { const r = [...formData.recurringSupplies]; r[idx].minDays = Number(e.target.value); setFormData(prev => ({...prev, recurringSupplies: r})); }} placeholder="1" className="text-xs" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Estancia Máx. (Días)</Label>
                            <Input type="number" value={rule.maxDays} onChange={(e) => { const r = [...formData.recurringSupplies]; r[idx].maxDays = Number(e.target.value); setFormData(prev => ({...prev, recurringSupplies: r})); }} placeholder="3" className="text-xs" />
                          </div>
                        </div>
                      </div>
                    ))}
                    <Button variant="outline" className="w-full border-dashed gap-2 text-xs h-12"
                      onClick={() => setFormData(prev => ({ ...prev, recurringSupplies: [...prev.recurringSupplies, { item: "", minDays: 1, maxDays: 3, quantity: 1 }] }))}>
                      <Plus className="h-4 w-4" /> Agregar Regla de Insumo
                    </Button>
                    <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 flex gap-3">
                      <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">Estas reglas se aplicarán a todas las tareas de limpieza generadas para esta propiedad.</p>
                    </div>
                  </div>

                  {/* ── Camas e Instrucciones ────────────────────────────────── */}
                  <div className="border-t pt-5 space-y-4">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      <Bed className="h-4 w-4 text-primary" /> Configuración de Camas
                    </h4>
                    <Input placeholder="Ej: 2 Queen, 1 King" value={formData.bedConfiguration} onChange={(e) => setFormData(p => ({ ...p, bedConfiguration: e.target.value }))} className="h-10 text-sm" />
                  </div>

                  <div className="border-t pt-5 space-y-3">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      <FileText className="h-4 w-4 text-primary" /> Instrucciones Base de Limpieza
                    </h4>
                    <p className="text-xs text-muted-foreground">Aparecerán automáticamente en cada tarea de limpieza creada para esta propiedad.</p>
                    <textarea rows={4} placeholder="Ej: Abrir ventanas al llegar, desinfectar manijas..."
                      value={formData.standardInstructions} onChange={(e) => setFormData(p => ({ ...p, standardInstructions: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl border border-input bg-muted/20 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
                  </div>

                  {/* ── Evidencia Obligatoria ────────────────────────────────── */}
                  <div className="border-t pt-5 space-y-4">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      <Camera className="h-4 w-4 text-primary" /> Evidencia Final Obligatoria
                    </h4>
                    <p className="text-xs text-muted-foreground">Fotos que el staff debe subir para cerrar la tarea.</p>
                    <div className="flex flex-wrap gap-2">
                      {formData.evidenceCriteria.map((criterion, idx) => (
                        <Badge key={idx} variant="secondary" className="pl-3 pr-1 py-1 gap-1 bg-primary/5 text-primary border-primary/10 hover:bg-primary/10">
                          {criterion}
                          <button type="button" title="Eliminar criterio" onClick={() => setFormData(p => ({ ...p, evidenceCriteria: p.evidenceCriteria.filter((_, i) => i !== idx) }))} className="p-0.5 hover:bg-primary/20 rounded-full transition-colors"><X className="h-3 w-3" /></button>
                        </Badge>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input id="new-criterion-input" placeholder="Añadir criterio (ej: Terraza)" className="h-10 text-sm"
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const val = e.currentTarget.value.trim(); if (val && !formData.evidenceCriteria.includes(val)) { setFormData(p => ({ ...p, evidenceCriteria: [...p.evidenceCriteria, val] })); e.currentTarget.value = ""; } } }} />
                      <Button type="button" size="sm" className="gradient-gold text-primary-foreground h-10 px-4"
                        onClick={() => { const input = document.getElementById('new-criterion-input') as HTMLInputElement; const val = input.value.trim(); if (val && !formData.evidenceCriteria.includes(val)) { setFormData(p => ({ ...p, evidenceCriteria: [...p.evidenceCriteria, val] })); input.value = ""; } }}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="p-4 rounded-xl bg-primary/5 border border-primary/10 flex gap-3">
                      <Sparkles className="h-5 w-5 text-primary shrink-0" />
                      <p className="text-[10px] text-muted-foreground leading-relaxed">El asistente de limpieza exigirá cada uno de estos criterios antes de permitir el cierre de la tarea.</p>
                    </div>
                  </div>
                </div>
              ) : modalTab === "dispositivos" ? (
                <DevicesTabContent formData={formData} setFormData={setFormData} />
              ) : null}
            </div>

            {creationStep === "form" && (
            <div className="p-6 pt-0 flex items-center justify-end gap-3">
              <Button variant="outline" onClick={() => setShowModal(false)} disabled={isSaving}>Cancelar</Button>
              <Button 
                onClick={handleSave} 
                disabled={!formData.name || !formData.city || isSaving} 
                className="gradient-gold text-primary-foreground gap-2 min-w-[120px]"
              >
                {isSaving ? (
                  <><RefreshCw className="h-4 w-4 animate-spin" /> Guardando...</>
                ) : editingProperty ? (
                  <><CheckCircle2 className="h-4 w-4" /> Guardar Cambios</>
                ) : (
                  <><Plus className="h-4 w-4" /> Crear Propiedad</>
                )}
              </Button>
            </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
