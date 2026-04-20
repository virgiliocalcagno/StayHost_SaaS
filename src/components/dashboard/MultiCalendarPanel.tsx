"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  Search, 
  DollarSign,
  Plus,
  PlayCircle,
  HelpCircle,
  Settings,
  Circle,
  LogOut,
  LogIn,
  Camera,
  Sparkles,
  CreditCard,
  Globe,
  Phone,
  Edit3,
  Trash2,
  X,
  Loader2,
  Copy,
  Check,
  MessageCircle,
  KeyRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useState, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ChargeServiceDrawer from "./ChargeServiceDrawer";

// Returns YYYY-MM-DD in the USER's local timezone — never UTC.
// toISOString() was the old bug: past ~8pm in Chile (UTC-4), UTC already
// counts as "tomorrow", so the calendar highlighted the wrong day.
const toLocalDateStr = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

// Mock Data with Channel Info and Real Dates (Relative to current month for demo)
const generateMockBookings = () => {
  const getDateStr = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return toLocalDateStr(d);
  };

  return [
    { id: 1, name: "Pool + Free Shuttle to Beach", channel: "airbnb", price: 125, bookings: [
      { id: "b1", guest: "Maria Lopez", phone: null as string | null, phone4: null as string | null, numGuests: 2, totalPrice: 625, note: "" as string | null, start: getDateStr(-5), end: getDateStr(-1), status: "confirmed", channel: "airbnb" },
      { id: "b2", guest: "Carlos Mendez", phone: null, phone4: null, numGuests: 2, totalPrice: 500, note: null, start: getDateStr(2), end: getDateStr(6), status: "pending", channel: "direct" },
      { id: "b3", guest: "Ana Rodriguez", phone: null, phone4: null, numGuests: 2, totalPrice: 625, note: null, start: getDateStr(9), end: getDateStr(14), status: "confirmed", channel: "airbnb" },
    ]},
    { id: 2, name: "Apartamento Centro", channel: "booking", price: 89, bookings: [
      { id: "b4", guest: "Pedro Sanchez", phone: null, phone4: null, numGuests: 2, totalPrice: 267, note: null, start: getDateStr(0), end: getDateStr(3), status: "confirmed", channel: "booking" },
      { id: "b5", guest: "Luisa Gomez", phone: null, phone4: null, numGuests: 2, totalPrice: 267, note: null, start: getDateStr(3), end: getDateStr(6), status: "confirmed", channel: "direct" },
    ]},
    { id: 3, name: "Casa de Playa Sunset", channel: "vrbo", price: 210, bookings: [
      { id: "b6", guest: "Sofia Castro", phone: null, phone4: null, numGuests: 2, totalPrice: 630, note: null, start: getDateStr(-2), end: getDateStr(1), status: "confirmed", channel: "vrbo" },
      { id: "b7", guest: "Jorge Diaz", phone: null, phone4: null, numGuests: 2, totalPrice: 840, note: null, start: getDateStr(1), end: getDateStr(5), status: "confirmed", channel: "airbnb" },
      { id: "b7b", guest: "Mariano Suarez", phone: null, phone4: null, numGuests: 2, totalPrice: 840, note: null, start: getDateStr(5), end: getDateStr(9), status: "pending", channel: "booking" },
    ]},
    { id: 4, name: "Loft Moderno CDMX", channel: "airbnb", price: 145, bookings: [
      { id: "b8", guest: "Roberto Jimenez", phone: null, phone4: null, numGuests: 2, totalPrice: 725, note: null, start: getDateStr(4), end: getDateStr(9), status: "pending", channel: "airbnb" },
    ]},
    { id: 5, name: "Cabana en el Bosque", channel: "direct", price: 180, bookings: [] },
    { id: 6, name: "Penthouse Vista al Mar", channel: "booking", price: 450, bookings: [
      { id: "b9", guest: "Fernanda Torres", phone: null, phone4: null, numGuests: 2, totalPrice: 4050, note: null, start: getDateStr(-1), end: getDateStr(8), status: "confirmed", channel: "booking" },
    ]},
  ];
};

const initialMockBookings = generateMockBookings();
const daysOfWeek = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];
const todayStr = toLocalDateStr(new Date());

const ChannelIcon = ({ channel, className }: { channel?: string, className?: string }) => {
  switch (channel) {
    case "airbnb": 
      return <div className={cn("w-4 h-4 rounded-full bg-rose-500 flex items-center justify-center text-[8px] text-white font-bold shadow-sm", className)}>A</div>;
    case "booking": 
      return <div className={cn("w-4 h-4 rounded-full bg-blue-600 flex items-center justify-center text-[8px] text-white font-bold shadow-sm", className)}>B</div>;
    case "vrbo": 
      return <div className={cn("w-4 h-4 rounded-full bg-indigo-500 flex items-center justify-center text-[8px] text-white font-bold shadow-sm", className)}>V</div>;
    default: 
      return <div className={cn("w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center text-[8px] text-white font-bold shadow-sm", className)}>D</div>;
  }
};

export default function MultiCalendarPanel() {
  const [properties, setProperties] = useState<typeof initialMockBookings>([]);
  const [currentDate, setCurrentDate] = useState(new Date()); 
  const [viewMode, setViewMode] = useState<"calendar" | "price">("calendar");
  const [isNewBookingOpen, setIsNewBookingOpen] = useState(false);
  const [isBlockOpen, setIsBlockOpen] = useState(false);
  const [blockForm, setBlockForm] = useState({ propertyId: "", start: "", end: "", note: "" });
  const [savingBlock, setSavingBlock] = useState(false);
  const [newBooking, setNewBooking] = useState({
    propertyId: "1",
    guest: "",
    docIdentidad: "",
    nacionalidad: "",
    telefono: "",
    numHuespedes: 2,
    start: "",
    end: "",
    channel: "direct",
    status: "confirmed",
    price: 0
  });

  const loadData = () => {
    // Tenant is resolved server-side from the session cookie.
    fetch("/api/bookings", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((data) => { if (data.properties?.length) setProperties(data.properties); })
      .catch(() => {});
  };

  useEffect(() => { loadData(); }, []);

  // Pago de servicios extras
  const [isChargeOpen, setIsChargeOpen] = useState(false);
  const [selectedBookingForCharge, setSelectedBookingForCharge] = useState<{id: string, guest: string, property: string} | null>(null);

  const openChargeDrawer = (booking: { id: string; guest: string }, propertyName: string) => {
    setSelectedBookingForCharge({
      id: booking.id,
      guest: booking.guest,
      property: propertyName
    });
    setIsChargeOpen(true);
  };

  const handleSaveBlock = async () => {
    if (!blockForm.propertyId || !blockForm.start || !blockForm.end) return;
    setSavingBlock(true);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          propertyId: blockForm.propertyId,
          checkIn: blockForm.start,
          checkOut: blockForm.end,
          source: "block",
          note: blockForm.note || null,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setIsBlockOpen(false);
        setBlockForm({ propertyId: "", start: "", end: "", note: "" });
        loadData();
      }
    } catch {}
    setSavingBlock(false);
  };

  const [savingBooking, setSavingBooking] = useState(false);

  // Resultado de la creación — se muestra en un modal con el código de check-in
  // recién generado + acciones de compartir. Null = oculto.
  const [createdBookingInfo, setCreatedBookingInfo] = useState<{
    channelCode: string;
    phoneLast4: string | null;
    guestName: string;
    guestPhone: string;
    propertyName: string;
  } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const handleCreateBooking = async () => {
    if (!newBooking.guest || !newBooking.start || !newBooking.end) return;
    setSavingBooking(true);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          propertyId: newBooking.propertyId,
          checkIn: newBooking.start,
          checkOut: newBooking.end,
          guestName: newBooking.guest,
          guestPhone: newBooking.telefono || null,
          guestDoc: newBooking.docIdentidad || null,
          guestNationality: newBooking.nacionalidad || null,
          source: newBooking.channel,
          numGuests: newBooking.numHuespedes,
          totalPrice: newBooking.price,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        const prop = properties.find((p) => String(p.id) === String(newBooking.propertyId));
        setIsNewBookingOpen(false);
        // Solo mostramos el modal de confirmación si la API devolvió
        // channelCode (reservas directas con la migración corrida). Si no,
        // cerramos silenciosamente como antes.
        if (data.channelCode) {
          setCreatedBookingInfo({
            channelCode: data.channelCode,
            phoneLast4: data.phoneLast4 ?? null,
            guestName: newBooking.guest,
            guestPhone: newBooking.telefono || "",
            propertyName: prop?.name ?? "",
          });
        }
        setNewBooking({ propertyId: "1", guest: "", docIdentidad: "", nacionalidad: "", telefono: "", numHuespedes: 2, start: "", end: "", channel: "direct", status: "confirmed", price: 0 });
        loadData();
      }
    } catch {}
    setSavingBooking(false);
  };

  // Arma el link con el código pre-rellenado para compartir con el huésped.
  const buildCheckinUrl = (code: string) => {
    if (typeof window === "undefined") return `/checkin?code=${encodeURIComponent(code)}`;
    return `${window.location.origin}/checkin?code=${encodeURIComponent(code)}`;
  };

  const shareBookingWhatsApp = (info: NonNullable<typeof createdBookingInfo>) => {
    const url = buildCheckinUrl(info.channelCode);
    const lines = [
      `¡Hola ${info.guestName}! 👋`,
      ``,
      `Te doy la bienvenida a *${info.propertyName}*.`,
      ``,
      `Para completar tu check-in online, entrá a:`,
      url,
      ``,
      `Tu código de reserva ya viene cargado.`,
      info.phoneLast4
        ? `Vas a necesitar los últimos 4 dígitos del teléfono que nos pasaste.`
        : `Vas a necesitar los últimos 4 dígitos de tu teléfono.`,
      ``,
      `¡Cualquier duda, me avisás!`,
    ];
    const text = lines.join("\n");
    const cleanPhone = info.guestPhone.replace(/\D/g, "");
    if (cleanPhone.length >= 8) {
      window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`, "_blank");
      return;
    }
    // Sin teléfono completo → Web Share API o WhatsApp Web sin número
    type NavigatorWithShare = Navigator & { share?: (data: ShareData) => Promise<void> };
    const nav = navigator as NavigatorWithShare;
    if (nav.share) {
      nav.share({ title: "Check-in StayHost", text }).catch(() => {});
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const copyChannelCode = (code: string) => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleDeleteBooking = async (bookingId: string) => {
    if (!confirm("¿Eliminar esta reserva? Los PINs asociados también se eliminarán.")) return;
    await fetch(`/api/bookings?bookingId=${bookingId}`, { method: "DELETE" });
    loadData();
  };

  const handleCancelBooking = async (bookingId: string) => {
    if (!confirm("¿Cancelar esta reserva? Los PINs asociados serán revocados.")) return;
    await fetch("/api/bookings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ bookingId, status: "cancelled" }),
    });
    loadData();
  };

  // Edit booking state
  const [editingBooking, setEditingBooking] = useState<{
    id: string; guest: string; phone: string; start: string; end: string;
    numGuests: number; totalPrice: number; note: string;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const handleOpenEdit = (booking: Record<string, unknown>) => {
    setEditingBooking({
      id: String(booking.id),
      guest: String(booking.guest ?? ""),
      phone: String(booking.phone ?? ""),
      start: String(booking.start ?? ""),
      end: String(booking.end ?? ""),
      numGuests: Number(booking.numGuests ?? 1),
      totalPrice: Number(booking.totalPrice ?? 0),
      note: String(booking.note ?? ""),
    });
  };

  const handleSaveEdit = async () => {
    if (!editingBooking) return;
    setSavingEdit(true);
    try {
      const res = await fetch("/api/bookings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          bookingId: editingBooking.id,
          guestName: editingBooking.guest,
          guestPhone: editingBooking.phone || null,
          checkIn: editingBooking.start,
          checkOut: editingBooking.end,
          numGuests: editingBooking.numGuests,
          totalPrice: editingBooking.totalPrice,
          note: editingBooking.note || null,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setEditingBooking(null);
        loadData();
      } else {
        alert(data.error ?? "Error al actualizar");
      }
    } catch {
      alert("Error de conexión");
    }
    setSavingEdit(false);
  };
  const daysToShow = 21; // Mostrar 3 semanas

  const daysInView = useMemo(() => {
    const days = [];
    const startDate = new Date(currentDate);
    startDate.setHours(0, 0, 0, 0); // Inicio exacto a medianoche para calculos precisos de width
    startDate.setDate(startDate.getDate() - 3); // 3 dias antes
    for (let i = 0; i < daysToShow; i++) {
      const day = new Date(startDate);
      day.setDate(day.getDate() + i);
      const str = toLocalDateStr(day);
      days.push({
        date: day,
        str,
        isToday: str === todayStr
      });
    }
    return days;
  }, [currentDate]);

  const viewStartMs = daysInView[0].date.getTime();
  // El fin visual es a la medianoche del *último día mostrado + 1 día* para considerar todo el ancho.
  const viewEndMs = daysInView[daysInView.length - 1].date.getTime() + (24 * 60 * 60 * 1000); 
  const totalViewMs = viewEndMs - viewStartMs;

  const navigateDate = (days: number) => {
    const nextDate = new Date(currentDate);
    nextDate.setDate(nextDate.getDate() + days);
    setCurrentDate(nextDate);
  };

  const navigateToday = () => {
    setCurrentDate(new Date());
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex-none flex items-center justify-between mb-4 border-b pb-4">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-black tracking-tight text-primary">Multi-calendario</h2>
          <div className="flex items-center gap-1 bg-primary/10 px-3 py-1 rounded-full text-[10px] font-black uppercase text-primary border border-primary/20">
            <span>Sincronización Activa</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="gap-2 text-xs font-bold text-muted-foreground hover:text-primary">
            <PlayCircle className="h-4 w-4" />
            <span>Tour guiado</span>
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <HelpCircle className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex-none flex flex-wrap items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-xl border border-border/50">
          <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-background shadow-none" onClick={() => navigateDate(-7)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="font-black px-4 text-sm capitalize">
            {currentDate.toLocaleDateString("es-ES", { month: 'long', year: 'numeric' })}
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground font-bold hover:text-foreground" onClick={navigateToday}>
            Hoy
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-background shadow-none" onClick={() => navigateDate(7)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-muted/50 p-1 rounded-xl mr-2 border border-border/50">
            <Button 
              variant={viewMode === "calendar" ? "secondary" : "ghost"} 
              size="sm" 
              className={cn("h-8 px-3 transition-all", viewMode === "calendar" && "shadow-sm bg-background")}
              onClick={() => setViewMode("calendar")}
            >
              <CalendarIcon className="h-4 w-4" />
            </Button>
            <Button 
              variant={viewMode === "price" ? "secondary" : "ghost"} 
              size="sm" 
              className={cn("h-8 px-3 transition-all", viewMode === "price" && "shadow-sm bg-background")}
              onClick={() => setViewMode("price")}
            >
              <DollarSign className="h-4 w-4" />
            </Button>
          </div>
          <Sheet open={isBlockOpen} onOpenChange={setIsBlockOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 border-primary/30 text-foreground font-semibold h-9 rounded-xl">
                <Plus className="h-4 w-4" />
                <span>Agregar Bloqueo</span>
              </Button>
            </SheetTrigger>
            <SheetContent className="sm:max-w-md w-full border-l-0 shadow-2xl flex flex-col p-0">
              <SheetHeader className="px-6 py-6 pb-2 border-b">
                <SheetTitle className="text-2xl font-black text-foreground">Bloquear Fechas</SheetTitle>
                <SheetDescription>Las fechas bloqueadas se sincronizan automáticamente a Airbnb y VRBO vía tu iCal propio.</SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                <div className="space-y-2">
                  <Label className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">Propiedad</Label>
                  <Select value={blockForm.propertyId} onValueChange={v => setBlockForm(f => ({ ...f, propertyId: v }))}>
                    <SelectTrigger className="h-11 bg-muted/30 border-border/50 rounded-xl">
                      <SelectValue placeholder="Selecciona propiedad..." />
                    </SelectTrigger>
                    <SelectContent>
                      {properties.map(p => <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">Desde</Label>
                    <Input type="date" className="h-11 bg-muted/30 border-border/50 rounded-xl" value={blockForm.start} onChange={e => setBlockForm(f => ({ ...f, start: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">Hasta</Label>
                    <Input type="date" className="h-11 bg-muted/30 border-border/50 rounded-xl" value={blockForm.end} onChange={e => setBlockForm(f => ({ ...f, end: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">Motivo (opcional)</Label>
                  <Input placeholder="Mantenimiento, uso personal..." className="h-11 bg-muted/30 border-border/50 rounded-xl" value={blockForm.note} onChange={e => setBlockForm(f => ({ ...f, note: e.target.value }))} />
                </div>
              </div>
              <div className="px-6 py-4 bg-muted/10 border-t flex gap-3 mt-auto">
                <Button variant="outline" className="flex-1 h-12 rounded-xl" onClick={() => setIsBlockOpen(false)}>Cancelar</Button>
                <Button className="flex-[1.5] h-12 rounded-xl bg-slate-900 text-white hover:bg-slate-800" disabled={savingBlock || !blockForm.propertyId || !blockForm.start || !blockForm.end} onClick={handleSaveBlock}>
                  {savingBlock ? "Guardando..." : "Bloquear Fechas"}
                </Button>
              </div>
            </SheetContent>
          </Sheet>
          <Sheet open={isNewBookingOpen} onOpenChange={setIsNewBookingOpen}>
            <SheetTrigger asChild>
              <Button className="gradient-primary text-white font-black h-9 rounded-xl shadow-elevated">
                Nueva Reserva
              </Button>
            </SheetTrigger>
            <SheetContent className="sm:max-w-md w-full border-l-0 shadow-2xl flex flex-col p-0">
              <SheetHeader className="px-6 py-6 pb-2 border-b">
                <SheetTitle className="text-2xl font-black text-foreground">Nueva Reserva</SheetTitle>
                <SheetDescription>
                  Añade una nueva reserva manualmente.
                </SheetDescription>
              </SheetHeader>

              {/* Módulo de Sincronización OCR (Solo Visual como en ref) */}
              <div className="px-6 pt-4 pb-2">
                <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-4 flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                     <div className="flex items-center gap-2 text-blue-600 font-bold text-[12px] uppercase tracking-wide">
                        <Sparkles className="w-4 h-4" /> Sincronización Inteligente
                     </div>
                     <p className="text-[11px] text-blue-600/70 font-medium">Escanea el ID/Pasaporte para auto-completar</p>
                  </div>
                  <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[11px] font-extrabold uppercase tracking-wider flex items-center gap-2 h-9 shadow-lg shadow-blue-500/20">
                    <Camera className="w-4 h-4" />
                    ESCANEAR
                  </Button>
                </div>
              </div>

              {/* Formulario Scrolleable */}
              <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">
                <div className="grid gap-5">
                  <div className="space-y-2">
                    <Label className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">Propiedad</Label>
                    <Select value={newBooking.propertyId} onValueChange={val => setNewBooking({...newBooking, propertyId: val})}>
                      <SelectTrigger className="h-11 bg-muted/30 border-border/50 rounded-xl">
                        <SelectValue placeholder="Selecciona una propiedad" />
                      </SelectTrigger>
                      <SelectContent>
                        {properties.map(p => (
                          <SelectItem key={p.id} value={p.id.toString()} className="font-medium">{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="guest" className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">Nombre del Huésped</Label>
                    <Input id="guest" placeholder="Nombre completo..." value={newBooking.guest} onChange={e => setNewBooking({...newBooking, guest: e.target.value})} className="h-11 bg-muted/30 border-border/50 rounded-xl" />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="docIdentidad" className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">Doc. Identidad</Label>
                      <div className="relative">
                        <Input id="docIdentidad" placeholder="ID o Pasaporte" value={newBooking.docIdentidad} onChange={e => setNewBooking({...newBooking, docIdentidad: e.target.value})} className="h-11 bg-muted/30 border-border/50 rounded-xl pr-10" />
                        <CreditCard className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="nacionalidad" className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">Nacionalidad</Label>
                      <div className="relative">
                        <Input id="nacionalidad" placeholder="Ej: DOM, ESP" value={newBooking.nacionalidad} onChange={e => setNewBooking({...newBooking, nacionalidad: e.target.value})} className="h-11 bg-muted/30 border-border/50 rounded-xl pr-10" />
                        <Globe className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="telefono" className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">Número de Teléfono</Label>
                    <div className="relative">
                      <Input id="telefono" type="tel" placeholder="+1 809 000 0000" value={newBooking.telefono} onChange={e => setNewBooking({...newBooking, telefono: e.target.value})} className="h-11 bg-muted/30 border-border/50 rounded-xl pr-10" />
                      <Phone className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="price" className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">Precio Total ($)</Label>
                    <div className="relative">
                      <Input id="price" type="number" placeholder="Ej. 1500" value={newBooking.price || ""} onChange={e => setNewBooking({...newBooking, price: Number(e.target.value)})} className="h-11 bg-muted/30 border-border/50 rounded-xl pl-8" />
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="checkin" className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">Check-in</Label>
                      <Input id="checkin" type="date" value={newBooking.start} onChange={e => setNewBooking({...newBooking, start: e.target.value})} className="h-11 bg-muted/30 border-border/50 rounded-xl" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="checkout" className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">Check-out</Label>
                      <Input id="checkout" type="date" value={newBooking.end} onChange={e => setNewBooking({...newBooking, end: e.target.value})} className="h-11 bg-muted/30 border-border/50 rounded-xl" />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2 space-y-2">
                      <Label className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">Fuente</Label>
                      <Select value={newBooking.channel} onValueChange={val => setNewBooking({...newBooking, channel: val})}>
                        <SelectTrigger className="h-11 bg-muted/30 border-border/50 rounded-xl">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="direct">Manual / Directo</SelectItem>
                          <SelectItem value="airbnb">Airbnb</SelectItem>
                          <SelectItem value="booking">Booking.com</SelectItem>
                          <SelectItem value="vrbo">VRBO</SelectItem>
                          <SelectItem value="other">Otro</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="numHuespedes" className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">Huéspedes</Label>
                      <Input id="numHuespedes" type="number" min="1" value={newBooking.numHuespedes} onChange={e => setNewBooking({...newBooking, numHuespedes: Number(e.target.value)})} className="h-11 bg-muted/30 border-border/50 rounded-xl" />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">Estado</Label>
                    <Select value={newBooking.status} onValueChange={val => setNewBooking({...newBooking, status: val})}>
                      <SelectTrigger className="h-11 bg-muted/30 border-border/50 rounded-xl">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="confirmed">Confirmada</SelectItem>
                        <SelectItem value="pending">Pendiente</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 bg-muted/10 border-t flex gap-3 mt-auto">
                <Button variant="outline" className="flex-1 h-12 rounded-xl" onClick={() => setIsNewBookingOpen(false)}>Cancelar</Button>
                <Button className="gradient-primary text-white font-bold flex-[1.5] h-12 rounded-xl" onClick={handleCreateBooking} disabled={savingBooking}>{savingBooking ? "Guardando..." : "Crear Registro"}</Button>
              </div>
            </SheetContent>

          </Sheet>
        </div>
      </div>

      {/* ── Modal post-creación: muestra el código de check-in generado ─── */}
      <Sheet open={!!createdBookingInfo} onOpenChange={(o) => !o && setCreatedBookingInfo(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {createdBookingInfo && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <div className="h-10 w-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                    <Check className="h-5 w-5 text-emerald-600" />
                  </div>
                  ¡Reserva creada!
                </SheetTitle>
                <SheetDescription>
                  Compartile el código con el huésped para que haga su check-in online.
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-5">
                {/* Código destacado */}
                <div className="bg-gradient-to-br from-sky-50 to-emerald-50 rounded-3xl border-2 border-emerald-200 p-6 text-center space-y-3">
                  <div className="flex items-center justify-center gap-2 text-[11px] font-bold text-emerald-700 uppercase tracking-widest">
                    <KeyRound className="h-3.5 w-3.5" />
                    Código de check-in
                  </div>
                  <p className="text-3xl font-black font-mono tracking-[0.3em] text-slate-900">
                    {createdBookingInfo.channelCode}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyChannelCode(createdBookingInfo.channelCode)}
                    className="gap-1.5"
                  >
                    {copiedCode ? (
                      <><Check className="h-3.5 w-3.5 text-emerald-600" /> Copiado</>
                    ) : (
                      <><Copy className="h-3.5 w-3.5" /> Copiar código</>
                    )}
                  </Button>
                </div>

                {/* Info del huésped */}
                <div className="rounded-2xl border bg-card p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Huésped</span>
                    <span className="font-semibold">{createdBookingInfo.guestName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Propiedad</span>
                    <span className="font-semibold truncate max-w-[200px]">{createdBookingInfo.propertyName}</span>
                  </div>
                  {createdBookingInfo.phoneLast4 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Auth (4 dígitos)</span>
                      <span className="font-mono font-semibold">••{createdBookingInfo.phoneLast4}</span>
                    </div>
                  )}
                </div>

                {/* Acciones */}
                <div className="space-y-2">
                  <Button
                    onClick={() => shareBookingWhatsApp(createdBookingInfo)}
                    className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                  >
                    <MessageCircle className="h-4 w-4 mr-2" />
                    Enviar por WhatsApp
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      const url = buildCheckinUrl(createdBookingInfo.channelCode);
                      navigator.clipboard.writeText(url).catch(() => {});
                      setCopiedCode(true);
                      setTimeout(() => setCopiedCode(false), 2000);
                    }}
                    className="w-full h-11"
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Copiar link del check-in
                  </Button>
                </div>

                <p className="text-[11px] text-center text-muted-foreground leading-relaxed">
                  El huésped entrará a <span className="font-mono">stayhost.app/checkin</span> con este código
                  + los últimos 4 dígitos de su teléfono para acceder al check-in online.
                </p>
              </div>

              <SheetFooter className="mt-6">
                <Button variant="ghost" onClick={() => setCreatedBookingInfo(null)} className="w-full">
                  Cerrar
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Calendar Grid */}
      <div className="flex-1 border rounded-2xl bg-card overflow-hidden flex flex-col shadow-soft border-border/60">
        <div className="grid grid-cols-[250px_1fr] flex-1 overflow-auto">
          {/* Properties Column */}
          <div className="sticky left-0 bg-card/95 backdrop-blur-sm border-r z-20">
            <div className="h-14 flex items-center px-4 border-b bg-muted/30 sticky top-0 z-30">
                <div className="relative w-full">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input placeholder="Buscar propiedad..." className="pl-8 h-8 text-[11px] bg-card border-border/50 shadow-none focus-visible:ring-1 focus-visible:ring-primary/30" />
                </div>
            </div>
            <div className="divide-y divide-border/40 text-[11px]">
              {properties.map(property => (
                <div key={property.id} className="h-12 flex items-center px-4 hover:bg-primary/[0.03] transition-colors group">
                  <ChannelIcon channel={property.channel} className="mr-3 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-bold truncate text-[11px] leading-tight group-hover:text-primary transition-colors text-foreground/90">{property.name}</p>
                    <p className="text-[9px] text-muted-foreground font-medium">Desde ${property.price}/noche</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Timeline & Data */}
          <div className="relative">
            {/* Header Dates */}
            <div className="sticky top-0 bg-card/95 backdrop-blur-sm z-10 flex border-b bg-muted/30 h-14">
              {daysInView.map((day) => (
                <div key={day.str} className={cn(
                  "flex-1 flex flex-col items-center justify-center border-r border-border/40 transition-colors min-w-[50px]",
                  day.isToday && "bg-primary/5 ring-1 ring-inset ring-primary/20"
                )}>
                  <p className="text-[9px] text-muted-foreground uppercase font-black tracking-widest opacity-80">
                    {daysOfWeek[day.date.getDay()]}
                  </p>
                  <p className={cn(
                    "text-sm font-black",
                    day.isToday ? "text-primary" : "text-foreground/80"
                  )}>{day.date.getDate()}</p>
                </div>
              ))}
            </div>

            {/* Booking / Price Rows */}
            <div className="divide-y divide-border/40 relative">
              {properties.map(property => (
                <div key={property.id} className="h-12 border-b flex relative transition-colors hover:bg-primary/[0.01]">
                  {/* Background cells */}
                  {daysInView.map((day) => {
                    const isBooked = property.bookings.some(booking => {
                      const [sy, sm, sd] = booking.start.split("-").map(Number);
                      const startD = new Date(sy, sm - 1, sd).getTime();
                      const [ey, em, ed] = booking.end.split("-").map(Number);
                      const endD = new Date(ey, em - 1, ed).getTime();
                      
                      // Un "día" del grid representa la noche de ese día.
                      // Está bloqueado si la fecha actual es >= a la fecha de inicio, Y la fecha actual es ESTRICTAMENTE menor a la fecha de fin (checkout day is free).
                      return day.date.getTime() >= startD && day.date.getTime() < endD;
                    });

                    return (
                      <div key={day.str} className={cn(
                        "flex-1 border-r border-border/40 h-full flex items-center justify-center min-w-[50px] transition-colors relative overlay-cell",
                        day.isToday && "bg-primary/[0.03]",
                        viewMode === "price" && isBooked && "bg-rose-500/10"
                      )}>
                        {viewMode === "price" && (
                          <>
                            <span className={cn(
                              "text-[10px] font-black tracking-tighter relative z-10",
                              isBooked ? "text-rose-600/50 dark:text-rose-400/50 line-through" : "text-foreground/70"
                            )}>
                              ${property.price}
                            </span>
                            {/* Patrón rayado rosado dramático para bloqueo */}
                            {isBooked && (
                              <div className="absolute inset-0 opacity-[0.06] bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,#e11d48_10px,#e11d48_20px)] pointer-events-none"></div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}

                  {/* Bookings Overlay */}
                  {viewMode === "calendar" && property.bookings.map(booking => {
                    // Prevenir el bug de zona horaria de JS al parsear "YYYY-MM-DD" (que asume UTC y retrasa un día localmente en América)
                    const [sy, sm, sd] = booking.start.split("-").map(Number);
                    const startD = new Date(sy, sm - 1, sd, 14, 0, 0, 0); // Check-in 14:00 local

                    const [ey, em, ed] = booking.end.split("-").map(Number);
                    const endD = new Date(ey, em - 1, ed, 11, 0, 0, 0); // Check-out 11:00 local
                    
                    // Si toda la reserva ocurre antes de la vista visible, o toda después, no la dibujes.
                    if (endD.getTime() < viewStartMs || startD.getTime() > viewEndMs) {
                      return null; 
                    }

                    // Calcular la posición visual recortando según los boundaries de vista ms
                    const visualStartMs = Math.max(startD.getTime(), viewStartMs);
                    const visualEndMs = Math.min(endD.getTime(), viewEndMs);
                    
                    const leftPct = ((visualStartMs - viewStartMs) / totalViewMs) * 100;
                    const widthPct = ((visualEndMs - visualStartMs) / totalViewMs) * 100;

                    const isOutLeft = startD.getTime() < viewStartMs;
                    const isOutRight = endD.getTime() > viewEndMs;

                    const isBlock = booking.channel === "block" || booking.status === "blocked";

                    return (
                      <Popover key={booking.id}>
                        <PopoverTrigger asChild>
                          <div
                            className={cn(
                              "absolute top-1/2 -translate-y-1/2 h-8 flex items-center px-2 rounded-lg text-[10px] font-black shadow-soft cursor-pointer hover:brightness-110 transition-all border select-none",
                              isBlock
                                ? "bg-slate-400 text-white border-slate-300 bg-[repeating-linear-gradient(45deg,#64748b,#64748b_6px,#94a3b8_6px,#94a3b8_12px)]"
                                : booking.status === "confirmed"
                                  ? (booking.channel === "airbnb" ? "bg-rose-500 text-white border-white/20" : booking.channel === "booking" ? "bg-blue-600 text-white border-white/20" : booking.channel === "vrbo" ? "bg-indigo-500 text-white border-white/20" : "bg-emerald-500 text-white border-white/20")
                                  : "bg-amber-500 text-amber-950 border-amber-400",
                              isOutLeft && "rounded-l-none border-l-0",
                              isOutRight && "rounded-r-none border-r-0"
                            )}
                            style={{ left: `calc(${leftPct}%)`, width: `calc(${widthPct}%)`, zIndex: 5 }}
                          >
                            {!isBlock && <ChannelIcon channel={booking.channel || "direct"} className="mr-1.5 w-3.5 h-3.5 bg-white/30 border-none shadow-none text-[7px]" />}
                            <span className="truncate">{isBlock ? "🔒 Bloqueado" : booking.guest}</span>
                          </div>
                        </PopoverTrigger>
                        <PopoverPrimitive.Portal>
                          <PopoverContent className="w-64 p-3 rounded-xl bg-card border border-border/50 text-sm shadow-2xl z-[100]" sideOffset={5}>
                            <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <ChannelIcon channel={booking.channel} />
                              <span className="font-bold text-foreground capitalize">{booking.channel}</span>
                            </div>
                            <span className={cn("text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider", booking.status === "confirmed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>
                              {booking.status}
                            </span>
                          </div>
                          <h4 className="font-black text-base">{booking.guest}</h4>
                          <p className="text-xs text-muted-foreground mb-3">{property.name}</p>
                          
                          <div className="flex justify-between items-center text-xs font-medium bg-muted/30 rounded-lg p-2 mb-3 border border-border/50">
                            <div className="flex flex-col">
                              <span className="text-muted-foreground text-[10px] uppercase font-bold">Check-in</span>
                              <span>{booking.start}</span>
                            </div>
                            <div className="h-6 w-px bg-border/50"></div>
                            <div className="flex flex-col text-right">
                              <span className="text-muted-foreground text-[10px] uppercase font-bold">Check-out</span>
                              <span>{booking.end}</span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between font-black text-sm mb-4">
                            <span className="text-muted-foreground">Payout Est.</span>
                            <span className="text-emerald-600 dark:text-emerald-400">${property.price * Math.max(1, Math.ceil((new Date(booking.end).getTime() - new Date(booking.start).getTime()) / (1000 * 3600 * 24)))}</span>
                          </div>

                          {booking.phone && (
                            <div className="flex items-center gap-2 text-xs mb-3 p-2 rounded-lg bg-muted/30 border border-border/50">
                              <Phone className="w-3 h-3 text-muted-foreground" />
                              <span>{booking.phone}</span>
                              {booking.phone4 && <Badge variant="outline" className="text-[9px] ml-auto">PIN: {booking.phone4}</Badge>}
                            </div>
                          )}

                          <div className="grid grid-cols-3 gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 rounded-xl text-[10px] font-bold gap-1"
                              onClick={() => { handleOpenEdit(booking); }}
                            >
                              <Edit3 className="w-3 h-3" />
                              Editar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 rounded-xl text-[10px] font-bold border-amber-200 text-amber-600 hover:bg-amber-50 gap-1"
                              onClick={() => handleCancelBooking(booking.id)}
                            >
                              <X className="w-3 h-3" />
                              Cancelar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 rounded-xl text-[10px] font-bold border-red-200 text-red-500 hover:bg-red-50 gap-1"
                              onClick={() => handleDeleteBooking(booking.id)}
                            >
                              <Trash2 className="w-3 h-3" />
                              Borrar
                            </Button>
                          </div>
                        </PopoverContent>
                        </PopoverPrimitive.Portal>
                      </Popover>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Legend / Footer */}
      <div className="flex-none flex items-center gap-6 mt-4 text-[9px] text-muted-foreground/80 font-bold px-4 uppercase tracking-wider">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
          <span>Directo</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-rose-500"></div>
          <span>Airbnb</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-blue-600"></div>
          <span>Booking.com</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
          <span>VRBO</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-amber-500"></div>
          <span>Pendiente / Bloqueo</span>
        </div>
      </div>
      <ChargeServiceDrawer
        isOpen={isChargeOpen}
        onClose={() => setIsChargeOpen(false)}
        bookingData={selectedBookingForCharge}
      />

      {/* Edit Booking Sheet */}
      <Sheet open={!!editingBooking} onOpenChange={(open) => { if (!open) setEditingBooking(null); }}>
        <SheetContent className="sm:max-w-md w-full border-l-0 shadow-2xl flex flex-col p-0">
          <SheetHeader className="px-6 py-6 pb-2 border-b">
            <SheetTitle className="text-xl font-black">Editar Reserva</SheetTitle>
            <SheetDescription>Modifica los datos de la reserva. Los PINs se actualizarán automáticamente.</SheetDescription>
          </SheetHeader>
          {editingBooking && (
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-bold">Huésped</Label>
                <Input value={editingBooking.guest} onChange={(e) => setEditingBooking((p) => p ? { ...p, guest: e.target.value } : p)} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold">Teléfono</Label>
                <Input value={editingBooking.phone} onChange={(e) => setEditingBooking((p) => p ? { ...p, phone: e.target.value } : p)} placeholder="+1 787 555 1234" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs font-bold">Check-in</Label>
                  <Input type="date" value={editingBooking.start} onChange={(e) => setEditingBooking((p) => p ? { ...p, start: e.target.value } : p)} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold">Check-out</Label>
                  <Input type="date" value={editingBooking.end} onChange={(e) => setEditingBooking((p) => p ? { ...p, end: e.target.value } : p)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs font-bold">Huéspedes</Label>
                  <Input type="number" min={1} value={editingBooking.numGuests} onChange={(e) => setEditingBooking((p) => p ? { ...p, numGuests: Number(e.target.value) || 1 } : p)} />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold">Precio Total</Label>
                  <Input type="number" min={0} step="0.01" value={editingBooking.totalPrice} onChange={(e) => setEditingBooking((p) => p ? { ...p, totalPrice: Number(e.target.value) || 0 } : p)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold">Nota</Label>
                <Textarea value={editingBooking.note} onChange={(e) => setEditingBooking((p) => p ? { ...p, note: e.target.value } : p)} placeholder="Notas internas..." rows={3} />
              </div>
            </div>
          )}
          <SheetFooter className="px-6 py-4 border-t">
            <div className="flex gap-2 w-full">
              <Button variant="outline" className="flex-1" onClick={() => setEditingBooking(null)}>Cancelar</Button>
              <Button className="flex-1 gradient-gold text-primary-foreground" onClick={handleSaveEdit} disabled={savingEdit}>
                {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar Cambios"}
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
