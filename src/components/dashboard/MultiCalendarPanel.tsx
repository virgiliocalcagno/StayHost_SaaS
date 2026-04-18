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
  Phone
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ChargeServiceDrawer from "./ChargeServiceDrawer";

// Mock Data with Channel Info and Real Dates (Relative to current month for demo)
const generateMockBookings = () => {
  const getDateStr = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().split("T")[0];
  };

  return [
    { id: 1, name: "Pool + Free Shuttle to Beach", channel: "airbnb", price: 125, bookings: [
      { id: "b1", guest: "Maria Lopez", start: getDateStr(-5), end: getDateStr(-1), status: "confirmed", channel: "airbnb" },
      { id: "b2", guest: "Carlos Mendez", start: getDateStr(2), end: getDateStr(6), status: "pending", channel: "direct" },
      { id: "b3", guest: "Ana Rodriguez", start: getDateStr(9), end: getDateStr(14), status: "confirmed", channel: "airbnb" },
    ]},
    { id: 2, name: "Apartamento Centro", channel: "booking", price: 89, bookings: [
      // BACK-TO-BACK DEMO 1: Luisa hace Check-in el mismo dia que sale Pedro (Dia 3)
      { id: "b4", guest: "Pedro Sanchez", start: getDateStr(0), end: getDateStr(3), status: "confirmed", channel: "booking" },
      { id: "b5", guest: "Luisa Gomez", start: getDateStr(3), end: getDateStr(6), status: "confirmed", channel: "direct" },
    ]},
    { id: 3, name: "Casa de Playa Sunset", channel: "vrbo", price: 210, bookings: [
      // BACK-TO-BACK DEMO 2: Jorge entra el mismo dia que sale Sofia (Dia 1)
      { id: "b6", guest: "Sofia Castro", start: getDateStr(-2), end: getDateStr(1), status: "confirmed", channel: "vrbo" },
      { id: "b7", guest: "Jorge Diaz", start: getDateStr(1), end: getDateStr(5), status: "confirmed", channel: "airbnb" },
      { id: "b7b", guest: "Mariano Suarez", start: getDateStr(5), end: getDateStr(9), status: "pending", channel: "booking" }, // Triple back-to-back!
    ]},
    { id: 4, name: "Loft Moderno CDMX", channel: "airbnb", price: 145, bookings: [
      { id: "b8", guest: "Roberto Jimenez", start: getDateStr(4), end: getDateStr(9), status: "pending", channel: "airbnb" },
    ]},
    { id: 5, name: "Cabana en el Bosque", channel: "direct", price: 180, bookings: [] },
    { id: 6, name: "Penthouse Vista al Mar", channel: "booking", price: 450, bookings: [
      { id: "b9", guest: "Fernanda Torres", start: getDateStr(-1), end: getDateStr(8), status: "confirmed", channel: "booking" },
    ]},
  ];
};

const initialMockBookings = generateMockBookings();
const daysOfWeek = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];
const todayStr = new Date().toISOString().split("T")[0];

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

  useEffect(() => {
    try {
      const session = localStorage.getItem("stayhost_session");
      const email = (session ? JSON.parse(session).email : null)
        || localStorage.getItem("stayhost_owner_email");
      if (!email) return;
      fetch(`/api/bookings?email=${encodeURIComponent(email)}`)
        .then((r) => r.json())
        .then((data) => { if (data.properties?.length) setProperties(data.properties); })
        .catch(() => {});
    } catch {}
  }, []);

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

  const handleCreateBooking = () => {
    if (!newBooking.guest || !newBooking.start || !newBooking.end) return;
    
    setProperties(prev => prev.map(p => {
      if (p.id.toString() === newBooking.propertyId) {
        return {
          ...p,
          bookings: [
            ...p.bookings,
            {
              id: `b${Date.now()}`,
              guest: newBooking.guest,
              start: newBooking.start,
              end: newBooking.end,
              status: newBooking.status,
              channel: newBooking.channel,
              price: newBooking.price
            }
          ]
        };
      }
      return p;
    }));
    
    setIsNewBookingOpen(false);
    setNewBooking({
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
      days.push({
        date: day,
        str: day.toISOString().split("T")[0],
        isToday: day.toISOString().split("T")[0] === todayStr
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
          <Button variant="outline" size="sm" className="gap-2 border-primary/30 text-foreground font-semibold h-9 rounded-xl">
            <Plus className="h-4 w-4" />
            <span>Agregar Bloqueo</span>
          </Button>
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
                <Button className="gradient-primary text-white font-bold flex-[1.5] h-12 rounded-xl" onClick={handleCreateBooking}>Crear Registro</Button>
              </div>
            </SheetContent>

          </Sheet>
        </div>
      </div>

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

                    return (
                      <Popover key={booking.id}>
                        <PopoverTrigger asChild>
                          <div
                            className={cn(
                              "absolute top-1/2 -translate-y-1/2 h-8 flex items-center px-2 rounded-lg text-[10px] font-black text-white shadow-soft cursor-pointer hover:brightness-110 transition-all border border-white/20 select-none",
                              booking.status === "confirmed" ? 
                                (booking.channel === "airbnb" ? "bg-rose-500" : (booking.channel === "booking" ? "bg-blue-600" : booking.channel === "vrbo" ? "bg-indigo-500" : "bg-emerald-500")) 
                                : "bg-amber-500 text-amber-950 border-amber-400",
                              isOutLeft && "rounded-l-none border-l-0",
                              isOutRight && "rounded-r-none border-r-0"
                            )}
                            style={{
                              left: `calc(${leftPct}%)`,
                              width: `calc(${widthPct}%)`,
                              zIndex: 5
                            }}
                          >
                            <ChannelIcon channel={booking.channel || "direct"} className="mr-1.5 w-3.5 h-3.5 bg-white/30 border-none shadow-none text-[7px]" />
                            <span className="truncate">{booking.guest}</span>
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

                          <Button 
                            className="w-full bg-[#635BFF] hover:bg-[#524be3] text-white text-[11px] font-black h-9 rounded-xl gap-2 shadow-lg shadow-blue-500/10"
                            onClick={() => openChargeDrawer(booking, property.name)}
                          >
                            <DollarSign className="w-3.5 h-3.5" />
                            COBRAR EXTRA
                          </Button>
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
    </div>
  );
}
