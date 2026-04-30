"use client";

import { use, useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Star, MapPin, ChevronLeft, Share, Heart,
  Users, BedDouble, Bath, Wifi, Car, Tv, Coffee,
  Wind, CheckCircle2, UtensilsCrossed, Palmtree,
  ShieldCheck, Globe, Tag, X, Loader2, PartyPopper,
  Calendar, Phone, Mail, User, AlertCircle, Sparkles,
} from "lucide-react";
import { useLanguage } from "../../LanguageContext";
import { cn } from "@/lib/utils";
import PublicStripeForm from "@/components/dashboard/PublicStripeForm";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoredProperty {
  id: string;
  name: string;
  address?: string;
  city?: string;
  image?: string;
  price?: number;
  cleaningFeeOneDay?: number;
  cleaningFeeMoreDays?: number;
  rating?: number;
  reviews?: number;
  maxGuests?: number;
  beds?: number;
  baths?: number;
  descriptionES?: string;
  descriptionEN?: string;
  amenities?: string[];
  evidenceCriteria?: string[];
  standardInstructions?: string;
}

interface StoredUpsell {
  id: string;
  name: string;
  description?: string;
  price: number;
  category?: string;
  iconName?: string;
  active?: boolean;
}

interface Coupon {
  id: string;
  code: string;
  type: "percent" | "fixed";
  amount: number;
  expiresAt: string;
  maxUses: number | null;
  usedCount: number;
  active: boolean;
}

interface DirectBooking {
  id: string;
  propertyId: string;
  propertyName: string;
  propertyImage?: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  checkin: string;
  checkout: string;
  nights: number;
  guests: number;
  baseTotal: number;
  upsellsTotal: number;
  discount: number;
  cleaningFee: number;
  taxes: number;
  total: number;
  couponCode?: string;
  upsellIds: string[];
  status: "confirmed" | "cancelled";
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const iconMap: Record<string, React.ElementType> = {
  Car, UtensilsCrossed, Palmtree, Sparkles, Coffee, Wifi, Tv, Wind,
};

const amenityIcons: Record<string, React.ElementType> = {
  wifi: Wifi, pool: Wind, parking: Car, ac: Wind, kitchen: Coffee,
  tv: Tv, washer: Sparkles, gym: User,
};

const amenityLabels: Record<string, { es: string; en: string }> = {
  wifi: { es: "Wi-Fi Rápido", en: "Fast Wi-Fi" },
  pool: { es: "Piscina Privada", en: "Private Pool" },
  parking: { es: "Estacionamiento", en: "Parking" },
  ac: { es: "Aire Acondicionado", en: "Air Conditioning" },
  kitchen: { es: "Cocina Equipada", en: "Equipped Kitchen" },
  tv: { es: "Smart TV", en: "Smart TV" },
  washer: { es: "Lavadora", en: "Washer" },
  gym: { es: "Gimnasio", en: "Gym" },
};

const DEFAULT_IMAGES = [
  "https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?w=1200&q=80",
  "https://images.unsplash.com/photo-1510798831971-661eb04b3739?w=800&q=80",
  "https://images.unsplash.com/photo-1502672260266-1c1de2d9668b?w=800&q=80",
  "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800&q=80",
  "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800&q=80",
];

const DEFAULT_UPSELLS: StoredUpsell[] = [
  { id: "u1", name: "Check-in Anticipado", description: "Llegada a partir de las 10:00 AM", price: 35, iconName: "Sparkles" },
  { id: "u2", name: "Check-out Tardío", description: "Salida hasta las 4:00 PM", price: 40, iconName: "Coffee" },
  { id: "u3", name: "Traslado Aeropuerto VIP", description: "Transporte privado en SUV", price: 85, iconName: "Car" },
];

function diffNights(checkin: string, checkout: string): number {
  if (!checkin || !checkout) return 0;
  const d1 = new Date(checkin).getTime();
  const d2 = new Date(checkout).getTime();
  return Math.max(0, Math.round((d2 - d1) / 86400000));
}

function formatDate(iso: string) {
  if (!iso) return "";
  return new Date(iso + "T00:00:00").toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PropertyPage({ params }: { params: Promise<{ hostId: string; propertyId: string }> }) {
  const resolvedParams = use(params);
  const { hostId, propertyId } = resolvedParams;
  const { lang, toggleLang, t } = useLanguage();

  // Property data viene del endpoint público — sin localStorage.
  // Upsells y coupons quedan vacíos por ahora (no hay tablas todavía;
  // Sprint 3.1 los construye).
  const [property, setProperty] = useState<StoredProperty | null>(null);
  const [propertyLoading, setPropertyLoading] = useState(true);
  const [upsells, setUpsells] = useState<StoredUpsell[]>(DEFAULT_UPSELLS);
  void setUpsells;
  const [coupons] = useState<Coupon[]>([]);
  // Fechas no disponibles para esta propiedad (confirmed/blocked) — vienen
  // del endpoint público y se usan para deshabilitar fechas en el picker
  // y validar antes de submit.
  const [unavailableRanges, setUnavailableRanges] = useState<
    Array<{ checkIn: string; checkOut: string; status: string }>
  >([]);

  useEffect(() => {
    fetch(`/api/public/hub/${encodeURIComponent(hostId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || !Array.isArray(data.properties)) return;
        const found = data.properties.find((p: { id: string }) => p.id === propertyId);
        if (found) setProperty(found as StoredProperty);
        // Cargar ranges no disponibles SOLO de esta propiedad.
        if (Array.isArray(data.unavailable)) {
          const filtered = (data.unavailable as Array<{
            propertyId: string; checkIn: string; checkOut: string; status: string;
          }>)
            .filter((u) => u.propertyId === propertyId)
            .map((u) => ({ checkIn: u.checkIn, checkOut: u.checkOut, status: u.status }));
          setUnavailableRanges(filtered);
        }
      })
      .catch(() => {})
      .finally(() => setPropertyLoading(false));
  }, [hostId, propertyId]);

  // ── Booking state ─────────────────────────────────────────────────────────
  // Local date YYYY-MM-DD — not UTC. Fixes the default check-in showing as
  // tomorrow after ~8pm in west-of-UTC timezones.
  const _toLocalDate = (d: Date) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };
  const today = _toLocalDate(new Date());
  const tomorrow = _toLocalDate(new Date(Date.now() + 86400000));
  const [checkin, setCheckin] = useState(today);
  const [checkout, setCheckout] = useState(tomorrow);
  const [guests, setGuests] = useState(2);
  const [selectedUpsellIds, setSelectedUpsellIds] = useState<string[]>([]);

  // ── Coupon state ──────────────────────────────────────────────────────────
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  const [couponError, setCouponError] = useState("");
  const [couponSuccess, setCouponSuccess] = useState("");

  // ── Checkout modal state ──────────────────────────────────────────────────
  const [showCheckout, setShowCheckout] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  // Identidad del huesped — obligatorio para LATAM (registro turistico,
  // anti-fraude). Sin docNumber + nacionalidad + foto del documento, no
  // se puede solicitar reserva.
  const [guestDoc, setGuestDoc] = useState("");
  const [guestNationality, setGuestNationality] = useState("");
  const [guestDocPhotoPath, setGuestDocPhotoPath] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bookingConfirmed, setBookingConfirmed] = useState<DirectBooking | null>(null);
  // ID corto de la solicitud para que el huesped tenga referencia.
  const [requestRefId, setRequestRefId] = useState<string | null>(null);

  // Chequeo de disponibilidad: el rango [checkin, checkout) se solapa con
  // alguna reserva confirmed/blocked? Mismo criterio del backend.
  const isRangeAvailable = useMemo(() => {
    if (!checkin || !checkout) return false;
    if (checkin >= checkout) return false;
    return !unavailableRanges.some((u) => u.checkIn < checkout && u.checkOut > checkin);
  }, [checkin, checkout, unavailableRanges]);

  // Escanear documento del huesped: igual que en NewBookingModal del host.
  // Reusa Gemini OCR pero via endpoint publico que valida hostId + sube la
  // foto al bucket bajo {tenantId}/hub-requests/{uuid}.
  const handleScanDoc = async (file: File) => {
    setScanning(true);
    setScanError(null);
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch(`/api/public/hub/${encodeURIComponent(hostId)}/scan-document`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const { doc } = (await res.json()) as {
        doc: {
          guestName?: string;
          docNumber?: string;
          nationality?: string;
          photoPath?: string;
        };
      };
      // Re-escanear SIEMPRE reemplaza los 3 campos OCR. Si el OCR no
      // detecta un campo, queda como string vacío y el huésped lo edita
      // a mano. Comportamiento estándar (Airbnb, Booking).
      setGuestName(doc.guestName ?? "");
      setGuestDoc(doc.docNumber ?? "");
      setGuestNationality(doc.nationality ?? "");
      if (doc.photoPath) setGuestDocPhotoPath(doc.photoPath);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  };

  // Limpia explicitamente los datos de identidad del huesped. Lo usa el
  // boton "Cambiar documento" cuando el huesped escaneo el doc equivocado.
  // No borra la foto del bucket (atacante podria DoS si pudiera) — queda
  // huerfana y un cron la limpia despues.
  const clearGuestIdentity = () => {
    setGuestName("");
    setGuestDoc("");
    setGuestNationality("");
    setGuestDocPhotoPath(null);
    setScanError(null);
  };

  // Reset completo del form. Lo llamamos cuando: (1) cambia la propiedad
  // (navegacion entre listings), (2) la solicitud se envio con exito (para
  // que si el huesped vuelve al Hub no vea datos stale).
  const resetBookingForm = () => {
    setShowCheckout(false);
    setGuestName("");
    setGuestEmail("");
    setGuestPhone("");
    setGuestDoc("");
    setGuestNationality("");
    setGuestDocPhotoPath(null);
    setScanError(null);
    setSubmitError(null);
    setSelectedUpsellIds([]);
    setAppliedCoupon(null);
    setCouponInput("");
    setCouponError("");
    setCouponSuccess("");
  };

  // Limpia el form al cambiar de propiedad (huesped navega entre listings).
  // Inline porque resetBookingForm se redefine en cada render — depender
  // de él dispararia el effect siempre. Los setters de useState son
  // estables, asi que no hace falta declararlos como deps.
  useEffect(() => {
    setShowCheckout(false);
    setGuestName("");
    setGuestEmail("");
    setGuestPhone("");
    setGuestDoc("");
    setGuestNationality("");
    setGuestDocPhotoPath(null);
    setScanError(null);
    setSubmitError(null);
    setSelectedUpsellIds([]);
    setAppliedCoupon(null);
    setCouponInput("");
    setCouponError("");
    setCouponSuccess("");
    setBookingConfirmed(null);
    setRequestRefId(null);
  }, [propertyId]);

  // ── Price calculations ────────────────────────────────────────────────────
  const nights = diffNights(checkin, checkout);
  const basePrice = property?.price ?? 200;
  const cleaningFee = nights === 1
    ? (property?.cleaningFeeOneDay ?? 85)
    : (property?.cleaningFeeMoreDays ?? 85);

  const upsellsTotal = selectedUpsellIds.reduce((acc, id) => {
    const u = upsells.find(u => u.id === id);
    return acc + (u?.price ?? 0);
  }, 0);

  const stayTotal = basePrice * Math.max(nights, 1);

  const discount = useMemo(() => {
    if (!appliedCoupon) return 0;
    if (appliedCoupon.type === "percent") return Math.round((stayTotal + upsellsTotal) * appliedCoupon.amount / 100);
    return appliedCoupon.amount;
  }, [appliedCoupon, stayTotal, upsellsTotal]);

  const subtotal = stayTotal + cleaningFee + upsellsTotal - discount;
  const taxes = Math.round(subtotal * 0.16);
  const finalTotal = subtotal + taxes;

  // ── Coupon logic ──────────────────────────────────────────────────────────
  const handleApplyCoupon = () => {
    setCouponError("");
    setCouponSuccess("");
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    const found = coupons.find(c => c.code === code);
    if (!found) { setCouponError("Código no encontrado."); return; }
    if (!found.active) { setCouponError("Este código está inactivo."); return; }
    if (found.expiresAt && new Date(found.expiresAt) < new Date()) { setCouponError("Este código ha expirado."); return; }
    if (found.maxUses !== null && found.usedCount >= found.maxUses) { setCouponError("Este código ya agotó sus usos disponibles."); return; }
    setAppliedCoupon(found);
    setCouponSuccess(`¡Cupón aplicado! ${found.type === "percent" ? `${found.amount}% de descuento` : `$${found.amount} de descuento`}`);
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponInput("");
    setCouponError("");
    setCouponSuccess("");
  };

  const toggleUpsell = (id: string) => {
    setSelectedUpsellIds(prev => prev.includes(id) ? prev.filter(u => u !== id) : [...prev, id]);
  };

  // ── Booking submission ────────────────────────────────────────────────────
  // POST a /api/public/hub/[hostId]/booking. Crea una solicitud
  // (status='pending_review') que el host aprueba/rechaza desde su panel.
  // No se cobra en este paso — el host coordina pago al confirmar.
  const handleConfirmBooking = async () => {
    setSubmitError(null);
    if (!guestName.trim() || !guestPhone.trim() || !guestDoc.trim() || !guestNationality.trim()) {
      setSubmitError("Completa nombre, teléfono, documento y nacionalidad para enviar la solicitud.");
      return;
    }
    if (!isRangeAvailable) {
      setSubmitError("Las fechas seleccionadas no están disponibles. Elegí otras fechas.");
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/public/hub/${encodeURIComponent(hostId)}/booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          checkIn: checkin,
          checkOut: checkout,
          guestName: guestName.trim(),
          guestPhone: guestPhone.trim(),
          guestDoc: guestDoc.trim(),
          guestNationality: guestNationality.trim().toUpperCase(),
          guestDocPhotoPath,
          numGuests: guests,
          note: guestEmail
            ? `Email del huésped: ${guestEmail.trim()}`
            : null,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { requestId?: string };
      setRequestRefId(json.requestId ?? null);
      const propName = property?.name ?? "Propiedad";
      const propImage = property?.image;
      const confirmation = {
        id: json.requestId ?? `req-${Date.now()}`,
        propertyId,
        propertyName: propName,
        propertyImage: propImage,
        guestName: guestName.trim(),
        guestEmail: guestEmail.trim(),
        guestPhone: guestPhone.trim(),
        checkin,
        checkout,
        nights: Math.max(nights, 1),
        guests,
        baseTotal: stayTotal,
        upsellsTotal,
        discount,
        cleaningFee,
        taxes,
        total: finalTotal,
        couponCode: appliedCoupon?.code,
        upsellIds: selectedUpsellIds,
        status: "confirmed" as const,
        createdAt: new Date().toISOString(),
      };
      // Reseteamos el form ANTES de mostrar la confirmación. La pantalla
      // de "Solicitud enviada" se renderiza con los datos del objeto
      // `confirmation`, no con los useState — así el form queda vacío
      // si el huésped vuelve atrás (ej. para hacer otra reserva).
      resetBookingForm();
      setBookingConfirmed(confirmation);
      void appliedCoupon;
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Render: Booking Confirmed Screen ─────────────────────────────────────
  if (bookingConfirmed) {
    return (
      <main className="min-h-screen bg-[#FDFBF7] flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center mx-auto shadow-xl">
            <PartyPopper className="h-12 w-12 text-green-600" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 mb-2">¡Solicitud enviada!</h1>
            <p className="text-slate-600">
              Tu solicitud para <strong>{bookingConfirmed.propertyName}</strong> está esperando aprobación.
              El host la revisa y te contacta para confirmar disponibilidad y coordinar el pago.
            </p>
            {requestRefId && (
              <p className="text-xs text-slate-500 mt-3 font-mono bg-slate-100 inline-block px-3 py-1 rounded-full">
                N° de referencia: {requestRefId.slice(0, 8).toUpperCase()}
              </p>
            )}
          </div>

          <div className="bg-amber-100 rounded-2xl p-4 border-2 border-amber-300 text-sm text-amber-900 flex items-start gap-3 text-left">
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold mb-1">Tu reserva NO está confirmada todavía</p>
              <p className="text-xs">
                Esto es una solicitud. El host puede aprobarla o rechazarla. <strong>No se realizó ningún cargo.</strong> Cuando el host apruebe, te enviará el método de pago.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 shadow-lg p-6 text-left space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1"><User className="h-3.5 w-3.5" /> Huésped</span>
              <span className="font-bold">{bookingConfirmed.guestName}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Check-in</span>
              <span className="font-bold">{formatDate(bookingConfirmed.checkin)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Check-out</span>
              <span className="font-bold">{formatDate(bookingConfirmed.checkout)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Noches</span>
              <span className="font-bold">{bookingConfirmed.nights}</span>
            </div>
            <div className="border-t pt-3 flex justify-between font-extrabold text-base">
              <span className="text-slate-700">Total estimado</span>
              <span className="text-slate-900">${bookingConfirmed.total.toLocaleString()}</span>
            </div>
            <p className="text-[10px] text-slate-400 italic">
              Estimado preliminar. El total final lo confirma el host al aprobar.
            </p>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1 rounded-2xl" asChild>
              <Link href={`/hub/${hostId}`}>← Volver al Hub</Link>
            </Button>
            <Button className="flex-1 gradient-gold text-white rounded-2xl font-bold border-none" onClick={() => window.print()}>
              Imprimir / Guardar
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const propName = property?.name ?? "Cargando propiedad...";
  const propImages = property?.image ? [property.image, ...DEFAULT_IMAGES.slice(1)] : DEFAULT_IMAGES;
  const propAmenities = property?.amenities ?? ["wifi", "pool", "parking", "ac", "kitchen"];

  return (
    <main className="min-h-screen bg-white text-slate-800 pb-24">

      {/* ── NAVBAR ─────────────────────────────────────────────────────────── */}
      <nav className="border-b border-slate-200 py-4 px-6 fixed top-0 w-full bg-white/95 backdrop-blur-md z-50">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link href={`/hub/${hostId}`} className="flex items-center gap-2 text-slate-600 hover:text-amber-600 font-medium transition-colors">
            <ChevronLeft className="w-5 h-5" />
            {t("back")}
          </Link>
          <div className="flex gap-4">
            <Button variant="ghost" size="sm" onClick={toggleLang} className="gap-2 font-bold uppercase hidden md:flex">
              <Globe className="w-4 h-4" /> {lang}
            </Button>
            <Button variant="ghost" size="sm" className="gap-2" onClick={() => navigator.share?.({ title: propName, url: window.location.href }).catch(() => {})}>
              <Share className="w-4 h-4" /> {t("share")}
            </Button>
            <Button variant="ghost" size="sm" className="gap-2">
              <Heart className="w-4 h-4" /> {t("save")}
            </Button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-6 pt-24 mt-4">

        {/* ── HEADER ───────────────────────────────────────────────────────── */}
        <div className="mb-6">
          <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight mb-2">{propName}</h1>
          <div className="flex flex-wrap items-center gap-4 text-sm font-medium text-slate-600">
            {property?.rating && (
              <span className="flex items-center gap-1 text-slate-900 font-bold">
                <Star className="w-4 h-4 fill-amber-500 text-amber-500" />
                {property.rating}
              </span>
            )}
            {property?.reviews && <span className="underline cursor-pointer">{property.reviews} {t("reviews")}</span>}
            {(property?.city || property?.address) && (
              <span className="flex items-center gap-1">
                <MapPin className="w-4 h-4" /> {property.city ?? property.address}
              </span>
            )}
          </div>
        </div>

        {/* ── PHOTO GRID ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 md:gap-3 rounded-2xl md:rounded-3xl overflow-hidden h-[400px] md:h-[500px] mb-12">
          <div className="md:col-span-2 md:row-span-2 relative h-full">
            <img src={propImages[0]} alt="Principal" className="w-full h-full object-cover hover:opacity-90 transition-opacity" />
          </div>
          {propImages.slice(1, 5).map((src, i) => (
            <div key={i} className="hidden md:block relative h-full">
              <img src={src} alt={`Foto ${i + 2}`} className="w-full h-full object-cover hover:opacity-90 transition-opacity" />
            </div>
          ))}
        </div>

        {/* ── TWO COLUMNS ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12 relative">

          {/* LEFT: Details */}
          <div className="lg:col-span-2">

            {/* Headline */}
            <div className="flex justify-between items-start pb-8 border-b border-slate-200">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 mb-2">
                  {lang === "es" ? (property?.descriptionES ? "Alojamiento exclusivo" : "Lujo frente al mar") : "Exclusive accommodation"}
                </h2>
                <div className="flex flex-wrap items-center gap-3 text-slate-600 font-medium">
                  {property?.maxGuests && <span className="flex items-center gap-1"><Users className="w-4 h-4" /> {property.maxGuests} {t("guests")}</span>}
                  {property?.beds && <><span>·</span><span className="flex items-center gap-1"><BedDouble className="w-4 h-4" /> {property.beds} {t("bedrooms")}</span></>}
                  {property?.baths && <><span>·</span><span className="flex items-center gap-1"><Bath className="w-4 h-4" /> {property.baths} {t("baths")}</span></>}
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="py-8 border-b border-slate-200">
              <h3 className="text-xl font-bold text-slate-900 mb-4">{t("aboutSpace")}</h3>
              <p className="text-slate-600 leading-relaxed whitespace-pre-line">
                {lang === "es"
                  ? (property?.descriptionES ?? "Espectacular propiedad con todas las comodidades para una estancia perfecta.")
                  : (property?.descriptionEN ?? "Spectacular property with all the amenities for a perfect stay.")}
              </p>
            </div>

            {/* Amenities */}
            <div className="py-8 border-b border-slate-200">
              <h3 className="text-xl font-bold text-slate-900 mb-6">{t("whatsIncluded")}</h3>
              <div className="grid grid-cols-2 gap-y-4 gap-x-8">
                {propAmenities.map((key) => {
                  const Icon = amenityIcons[key] ?? Sparkles;
                  const label = amenityLabels[key];
                  return (
                    <div key={key} className="flex items-center gap-4 text-slate-700 font-medium">
                      <Icon className="w-6 h-6 text-slate-400" />
                      <span>{label ? label[lang] : key}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── UPSELLS ──────────────────────────────────────────────────── */}
            <div className="py-8 border-b border-slate-200 bg-amber-50/50 -mx-6 px-6 sm:mx-0 sm:rounded-3xl border sm:border-amber-100 my-8">
              <Badge className="bg-amber-100 text-amber-700 font-bold mb-3 border-none uppercase tracking-wider text-[10px]">{t("powerYourExp")}</Badge>
              <h3 className="text-2xl font-bold text-slate-900 mb-2">{t("exclusiveServices")}</h3>
              <p className="text-slate-600 mb-6">{t("exclusiveDesc")}</p>
              <div className="space-y-4">
                {upsells.map(upsell => {
                  const isSelected = selectedUpsellIds.includes(upsell.id);
                  const Icon = iconMap[upsell.iconName ?? "Sparkles"] ?? Sparkles;
                  return (
                    <div
                      key={upsell.id}
                      onClick={() => toggleUpsell(upsell.id)}
                      className={cn(
                        "flex items-center p-4 border rounded-2xl transition-all cursor-pointer",
                        isSelected ? "border-amber-500 bg-amber-50/80 shadow-sm" : "border-slate-200 bg-white hover:border-amber-300"
                      )}
                    >
                      <div className={cn("p-3 rounded-xl mr-4", isSelected ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-500")}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <h4 className="font-bold text-slate-900">{upsell.name}</h4>
                        {upsell.description && <p className="text-sm text-slate-500">{upsell.description}</p>}
                      </div>
                      <div className="text-right flex flex-col items-end">
                        <span className="font-bold text-slate-900">${upsell.price}</span>
                        {isSelected
                          ? <CheckCircle2 className="w-5 h-5 text-amber-600 mt-1" />
                          : <div className="w-5 h-5 rounded-full border-2 border-slate-300 mt-1" />
                        }
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>

          {/* RIGHT: Booking Widget */}
          <div className="lg:col-span-1">
            <div className="sticky top-32">
              <Card className="border border-slate-200 shadow-2xl rounded-3xl overflow-hidden p-6 relative">
                <div className="absolute top-0 inset-x-0 h-1 gradient-gold" />

                {/* Price Header */}
                <div className="flex justify-between items-end mb-6">
                  <div>
                    <span className="text-3xl font-extrabold text-slate-900">${basePrice}</span>
                    <span className="text-slate-500 font-medium ml-1">{t("perNight")}</span>
                  </div>
                  <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> {t("directBooking")}
                  </span>
                </div>

                {/* Date & Guest Picker */}
                <div className="border border-slate-300 rounded-xl overflow-hidden mb-4">
                  <div className="flex border-b border-slate-300">
                    <div className="flex-1 p-3 border-r border-slate-300">
                      <label className="block text-[10px] font-extrabold uppercase text-slate-800 tracking-wider">Llegada</label>
                      <input
                        type="date"
                        title="Fecha de llegada"
                        aria-label="Fecha de llegada"
                        value={checkin}
                        min={today}
                        onChange={e => { setCheckin(e.target.value); if (e.target.value >= checkout) setCheckout(""); }}
                        className="w-full text-sm font-medium text-slate-600 focus:outline-none bg-transparent mt-0.5"
                      />
                    </div>
                    <div className="flex-1 p-3">
                      <label className="block text-[10px] font-extrabold uppercase text-slate-800 tracking-wider">Salida</label>
                      <input
                        type="date"
                        title="Fecha de salida"
                        aria-label="Fecha de salida"
                        value={checkout}
                        min={checkin || today}
                        onChange={e => setCheckout(e.target.value)}
                        className="w-full text-sm font-medium text-slate-600 focus:outline-none bg-transparent mt-0.5"
                      />
                    </div>
                  </div>
                  <div className="p-3 bg-white">
                    <label className="block text-[10px] font-extrabold uppercase text-slate-800 tracking-wider">Huéspedes</label>
                    <select
                      title="Número de huéspedes"
                      aria-label="Número de huéspedes"
                      className="w-full text-sm font-medium text-slate-600 focus:outline-none bg-transparent mt-0.5"
                      value={guests}
                      onChange={e => setGuests(Number(e.target.value))}
                    >
                      {Array.from({ length: property?.maxGuests ?? 8 }, (_, i) => i + 1).map(n => (
                        <option key={n} value={n}>{n} {n === 1 ? "huésped" : "huéspedes"}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Nights badge */}
                {nights > 0 && (
                  <div className="flex items-center justify-center gap-1.5 mb-2 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl py-2">
                    <Calendar className="h-3.5 w-3.5" />
                    {nights} {nights === 1 ? "noche" : "noches"} · {formatDate(checkin)} → {formatDate(checkout)}
                  </div>
                )}

                {/* Aviso de no disponibilidad — visible si el rango choca con
                    una reserva confirmada o un bloqueo. */}
                {nights > 0 && !isRangeAvailable && (
                  <div className="flex items-start gap-2 mb-4 p-3 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl">
                    <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>Estas fechas ya están ocupadas. Probá con otras fechas.</span>
                  </div>
                )}

                {/* Lista de proximos rangos no disponibles — ayuda al huesped
                    a elegir fechas libres sin tener que probar a ciegas. */}
                {unavailableRanges.length > 0 && (
                  <details className="mb-4 text-xs">
                    <summary className="cursor-pointer text-slate-600 font-semibold hover:text-amber-600">
                      Ver fechas no disponibles ({unavailableRanges.length})
                    </summary>
                    <ul className="mt-2 space-y-1 pl-2">
                      {unavailableRanges
                        .slice()
                        .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
                        .slice(0, 8)
                        .map((u, i) => (
                          <li key={i} className="text-slate-500">
                            {formatDate(u.checkIn)} → {formatDate(u.checkOut)}
                          </li>
                        ))}
                    </ul>
                  </details>
                )}

                {/* Coupon Field */}
                <div className="mb-4">
                  {appliedCoupon ? (
                    <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-xl">
                      <div className="flex items-center gap-2">
                        <Tag className="h-4 w-4 text-green-600" />
                        <div>
                          <p className="text-xs font-black text-green-800 uppercase">{appliedCoupon.code}</p>
                          <p className="text-[10px] text-green-600">{couponSuccess}</p>
                        </div>
                      </div>
                      <button type="button" onClick={handleRemoveCoupon} className="text-green-500 hover:text-red-500 transition-colors" aria-label="Quitar cupón">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex gap-2">
                        <Input
                          placeholder="Código de descuento"
                          value={couponInput}
                          onChange={e => { setCouponInput(e.target.value.toUpperCase()); setCouponError(""); }}
                          onKeyDown={e => e.key === "Enter" && handleApplyCoupon()}
                          className="rounded-xl font-mono uppercase text-sm"
                        />
                        <Button type="button" variant="outline" onClick={handleApplyCoupon} className="rounded-xl shrink-0 font-bold text-xs px-3">
                          Aplicar
                        </Button>
                      </div>
                      {couponError && (
                        <p className="text-xs text-red-500 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" /> {couponError}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Book Now */}
                <Button
                  className="w-full gradient-gold text-white font-bold text-lg py-7 rounded-xl hover:scale-[1.02] transition-transform shadow-lg shadow-amber-500/30 mb-4 border-none"
                  onClick={() => setShowCheckout(true)}
                  disabled={nights < 1 || !isRangeAvailable}
                >
                  {nights < 1
                    ? "Selecciona las fechas"
                    : !isRangeAvailable
                      ? "Fechas no disponibles"
                      : t("bookNow")}
                </Button>
                <p className="text-center text-xs text-slate-500 font-medium mb-6">{t("noChargeYet")}</p>

                {/* Price Breakdown */}
                <div className="space-y-3 text-slate-600 font-medium pb-4 border-b border-slate-200">
                  <div className="flex justify-between">
                    <span className="underline cursor-pointer decoration-slate-300">${basePrice} × {Math.max(nights, 1)} noches</span>
                    <span>${stayTotal}</span>
                  </div>
                  {upsellsTotal > 0 && (
                    <div className="flex justify-between text-amber-700">
                      <span className="flex items-center gap-1"><Star className="w-3.5 h-3.5" /> {t("extraServices")}</span>
                      <span>${upsellsTotal}</span>
                    </div>
                  )}
                  {discount > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span className="flex items-center gap-1"><Tag className="w-3.5 h-3.5" /> Descuento ({appliedCoupon?.code})</span>
                      <span>−${discount}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="underline cursor-pointer decoration-slate-300">{t("cleaningFee")}</span>
                    <span>${cleaningFee}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="underline cursor-pointer decoration-slate-300">{t("taxes")} (16%)</span>
                    <span>${taxes}</span>
                  </div>
                </div>
                <div className="flex justify-between items-center font-extrabold text-lg text-slate-900 pt-4">
                  <span>{t("total")}</span>
                  <span>${finalTotal.toLocaleString()}</span>
                </div>
              </Card>

              {/* Trust Badge */}
              <div className="mt-6 flex gap-3 items-center justify-center text-slate-500 bg-slate-50 p-4 rounded-xl border border-slate-100">
                <ShieldCheck className="w-8 h-8 text-amber-600" />
                <p className="text-xs font-medium leading-tight">
                  <strong className="text-slate-800 block">{t("securePayment")}</strong>
                  {t("securePaymentDesc")}
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── CHECKOUT MODAL ───────────────────────────────────────────────────── */}
      {showCheckout && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in">
          <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[95vh] overflow-y-auto animate-in slide-in-from-bottom-8 duration-400">

            {/* Modal Header */}
            <div className="sticky top-0 bg-white z-10 px-6 pt-6 pb-4 border-b flex items-center justify-between">
              <div>
                <h2 className="text-xl font-extrabold text-slate-900">Confirmar Reserva</h2>
                <p className="text-sm text-slate-500">{propName} · {Math.max(nights, 1)} noches</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCheckout(false)}
                aria-label="Cerrar"
                className="p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Stay Summary */}
              <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100 flex items-center justify-between">
                <div>
                  <p className="text-xs font-black text-amber-700 uppercase tracking-wider mb-1">Tu Estancia</p>
                  <p className="text-sm font-bold text-slate-800">{formatDate(checkin)} → {formatDate(checkout)}</p>
                  <p className="text-xs text-slate-500">{Math.max(nights, 1)} noches · {guests} huéspedes</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Total</p>
                  <p className="text-2xl font-extrabold text-amber-600">${finalTotal.toLocaleString()}</p>
                </div>
              </div>

              {/* Guest Form */}
              <div className="space-y-4">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" /> Datos del Huésped Principal
                </h3>

                <div className="space-y-1.5">
                  <Label htmlFor="guestName" className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Nombre Completo *
                  </Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      id="guestName"
                      placeholder="Ana García López"
                      value={guestName}
                      onChange={e => setGuestName(e.target.value)}
                      className="pl-10 rounded-xl"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="guestEmail" className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Correo Electrónico *
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      id="guestEmail"
                      type="email"
                      placeholder="ana@correo.com"
                      value={guestEmail}
                      onChange={e => setGuestEmail(e.target.value)}
                      className="pl-10 rounded-xl"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="guestPhone" className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    WhatsApp / Teléfono *
                  </Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      id="guestPhone"
                      type="tel"
                      placeholder="+52 55 1234 5678"
                      value={guestPhone}
                      onChange={e => setGuestPhone(e.target.value)}
                      className="pl-10 rounded-xl"
                    />
                  </div>
                </div>

                {/* Bloque Identidad — escanear ID y campos */}
                <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-blue-900">
                      <p className="font-bold mb-1">Identidad del huésped</p>
                      <p className="text-blue-700">
                        Para confirmar la reserva, necesitamos identificar al huésped principal.
                        Escaneá tu documento o cargá los datos manualmente. Tu información solo la
                        ve el host y se usa para el registro turístico.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      id="hubDocScan"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleScanDoc(f);
                        e.currentTarget.value = "";
                      }}
                    />
                    <Button
                      type="button"
                      onClick={() => document.getElementById("hubDocScan")?.click()}
                      disabled={scanning}
                      className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider gap-2"
                    >
                      {scanning ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Escaneando...</>
                      ) : guestDocPhotoPath ? (
                        <><Sparkles className="h-4 w-4" /> Volver a escanear</>
                      ) : (
                        <><Sparkles className="h-4 w-4" /> Escanear ID o pasaporte</>
                      )}
                    </Button>
                    {guestDocPhotoPath && (
                      <>
                        <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Foto guardada
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={clearGuestIdentity}
                          className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50 h-9 px-3"
                          title="Limpiar nombre, documento, nacionalidad y foto"
                        >
                          <X className="h-3.5 w-3.5 mr-1" /> Cambiar documento
                        </Button>
                      </>
                    )}
                  </div>
                  {scanError && (
                    <p className="text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" /> {scanError}
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="guestDoc" className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Documento *
                      </Label>
                      <Input
                        id="guestDoc"
                        placeholder="ID / Pasaporte"
                        value={guestDoc}
                        onChange={(e) => setGuestDoc(e.target.value)}
                        className="rounded-xl"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="guestNationality" className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Nacionalidad *
                      </Label>
                      <Input
                        id="guestNationality"
                        placeholder="DOM, ESP, USA..."
                        value={guestNationality}
                        onChange={(e) => setGuestNationality(e.target.value)}
                        className="rounded-xl uppercase"
                        maxLength={3}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Selected upsells summary */}
              {selectedUpsellIds.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-black uppercase tracking-wider text-slate-500">Servicios Seleccionados</p>
                  {selectedUpsellIds.map(id => {
                    const u = upsells.find(u => u.id === id);
                    return u ? (
                      <div key={id} className="flex justify-between text-sm text-slate-700">
                        <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-amber-500" />{u.name}</span>
                        <span className="font-bold">${u.price}</span>
                      </div>
                    ) : null;
                  })}
                </div>
              )}

              {/* Final price */}
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-2 text-sm">
                <div className="flex justify-between text-slate-600"><span>${basePrice} × {Math.max(nights, 1)} noches</span><span>${stayTotal}</span></div>
                {upsellsTotal > 0 && <div className="flex justify-between text-slate-600"><span>Servicios extra</span><span>${upsellsTotal}</span></div>}
                {discount > 0 && <div className="flex justify-between text-green-600"><span>Descuento ({appliedCoupon?.code})</span><span>−${discount}</span></div>}
                <div className="flex justify-between text-slate-600"><span>Limpieza</span><span>${cleaningFee}</span></div>
                <div className="flex justify-between text-slate-600"><span>Impuestos (16%)</span><span>${taxes}</span></div>
                <div className="flex justify-between font-extrabold text-base text-slate-900 border-t pt-2 mt-2">
                  <span>Total</span><span>${finalTotal.toLocaleString()}</span>
                </div>
              </div>

              {/* Submit error */}
              {submitError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}

              {/* Confirm Button */}
               <Button
                className="w-full gradient-gold text-white font-bold text-base py-6 rounded-2xl shadow-xl border-none hover:scale-[1.02] transition-transform disabled:opacity-50 disabled:grayscale disabled:scale-100"
                onClick={handleConfirmBooking}
                disabled={
                  isSubmitting ||
                  !guestName.trim() ||
                  !guestPhone.trim() ||
                  !guestDoc.trim() ||
                  !guestNationality.trim()
                }
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" /> Enviando solicitud...
                  </span>
                ) : (
                  "Enviar solicitud al host"
                )}
              </Button>

              <p className="text-center text-[10px] text-slate-400 font-medium leading-relaxed">
                Esto es una <strong>solicitud</strong>, no una reserva confirmada. El host la revisará
                y te contactará para coordinar el pago. No se realizará ningún cargo ahora.
              </p>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
