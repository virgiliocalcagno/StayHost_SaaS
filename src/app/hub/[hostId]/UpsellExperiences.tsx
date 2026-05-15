"use client";

// Catálogo de extras del Hub público + carrito + solicitud por WhatsApp.
//
// Sprint 3 (Fase A): el huésped puede ver productos con foto, leer detalle,
// armar carrito con cantidad ajustable según pricing_model, y enviar la
// solicitud por WhatsApp al host. El host responde el pago manualmente
// (Fase B agregará checkout PayPal + service_orders automáticas).
//
// Carrito persiste en sessionStorage para que el huésped no pierda lo que
// estaba armando si recarga la página o cierra el modal por error.

import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  ShoppingCart,
  X,
  Plus,
  Minus,
  MessageCircle,
  Store,
} from "lucide-react";
import { formatMoney } from "@/lib/money/format";
import { CategoryHero } from "@/lib/upsell/categoryVisuals";

// ─── Types ──────────────────────────────────────────────────────────────────
type PricingModel = "fixed" | "per_person" | "per_unit" | "per_kg" | "per_night";
type FieldVisibility = "off" | "optional" | "required";

interface HubUpsell {
  id: string;
  name: string;
  description: string | null;
  category: string;
  iconName: string;
  price: number;
  currency: string;
  heroPhoto: string | null;
  galleryPhotos: string[];
  pricingModel: PricingModel;
  minQuantity: number;
  maxQuantity: number | null;
  cutoffHours: number;
  // Sprint 5 — visibility por campo: "off" | "optional" | "required".
  // El detail modal renderiza solo los campos !== "off" y bloquea submit
  // solo si los "required" están vacíos.
  timeField: FieldVisibility;
  pickupField: FieldVisibility;
  flightField: FieldVisibility;
  notesPlaceholder: string | null;
  isGlobal: boolean;
  linkedPropertyIds: string[];
  vendor: { name: string; photo: string | null } | null;
}

interface CartItem {
  upsellId: string;
  name: string;
  pricingModel: PricingModel;
  unitPrice: number;
  quantity: number;
  currency: string;
  serviceDate: string | null; // YYYY-MM-DD
  // Sprint 5
  serviceTime: string | null;
  pickupLocation: string | null;
  flightNumber: string | null;
  extraNotes: string | null;
}

const PRICING_SUFFIX: Record<PricingModel, string> = {
  fixed: "",
  per_person: "persona",
  per_unit: "unidad",
  per_kg: "kg",
  per_night: "noche",
};

const CATEGORY_LABEL: Record<string, string> = {
  excursion: "Excursiones",
  transport: "Transporte",
  food: "Gastronomía",
  laundry: "Lavandería",
  spa: "Spa",
  concierge: "Concierge",
  rental: "Alquileres",
  connectivity: "Conectividad",
  service: "Servicios",
  other: "Otro",
};

const STORAGE_KEY_PREFIX = "stayhost.hub.cart.v1.";

// Fecha mínima permitida para un upsell según su cutoff_hours.
// Compartido entre el modal de detalle y la edición inline del carrito.
function getMinServiceDate(cutoffHours: number): string {
  const d = new Date();
  d.setHours(d.getHours() + cutoffHours);
  return d.toISOString().slice(0, 10);
}

// ─── Helper: lectura/escritura del carrito en sessionStorage ────────────────
// Por hostId para que el huésped que abre dos hubs distintos no mezcle.
function loadCart(hostId: string): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_PREFIX + hostId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCart(hostId: string, items: CartItem[]) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY_PREFIX + hostId, JSON.stringify(items));
  } catch {
    /* sessionStorage llena o private mode — best effort */
  }
}

// ─── Component ──────────────────────────────────────────────────────────────
interface Props {
  hostId: string;
  hostName: string;
  hostWhatsapp: string | null;
  experiences: HubUpsell[];
  lang: "es" | "en";
  /** Si el host tiene PayPal habilitado, mostramos "Pagar online" además del WhatsApp manual. */
  paypalEnabled: boolean;
}

export default function UpsellExperiences({
  hostId,
  hostName,
  hostWhatsapp,
  experiences,
  lang,
  paypalEnabled,
}: Props) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [detailOpen, setDetailOpen] = useState<HubUpsell | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  // Estados del checkout online (crear orden + redirigir a página de pago).
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  // Hidratar carrito tras el primer render (sessionStorage es client-only).
  useEffect(() => {
    setCart(loadCart(hostId));
    setHydrated(true);
  }, [hostId]);

  // Persistir cambios.
  useEffect(() => {
    if (hydrated) saveCart(hostId, cart);
  }, [cart, hostId, hydrated]);

  // ── Carrito helpers ──
  const cartCount = useMemo(
    () => cart.reduce((s, it) => s + it.quantity, 0),
    [cart],
  );
  const cartTotal = useMemo(
    () => cart.reduce((s, it) => s + it.quantity * it.unitPrice, 0),
    [cart],
  );

  const addToCart = useCallback((item: CartItem) => {
    setCart((prev) => {
      // Misma upsell + misma fecha → suma cantidad. Distinta fecha → item
      // nuevo (el huésped puede pedir 2 catamaranes en días diferentes).
      const idx = prev.findIndex(
        (it) => it.upsellId === item.upsellId && it.serviceDate === item.serviceDate,
      );
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + item.quantity };
        return next;
      }
      return [...prev, item];
    });
  }, []);

  const removeItem = useCallback((upsellId: string, serviceDate: string | null) => {
    setCart((prev) =>
      prev.filter((it) => !(it.upsellId === upsellId && it.serviceDate === serviceDate)),
    );
  }, []);

  const updateQty = useCallback(
    (upsellId: string, serviceDate: string | null, delta: number) => {
      setCart((prev) =>
        prev
          .map((it) =>
            it.upsellId === upsellId && it.serviceDate === serviceDate
              ? { ...it, quantity: Math.max(1, it.quantity + delta) }
              : it,
          )
          .filter((it) => it.quantity > 0),
      );
    },
    [],
  );

  // Cambiar fecha del item desde el carrito. Si el huésped ya tenía otro
  // item del mismo upsell con la fecha destino, fusionamos cantidades para
  // no dejar duplicados (1 + 1 → 2 en el mismo día).
  const updateServiceDate = useCallback(
    (upsellId: string, oldDate: string | null, newDate: string | null) => {
      if (oldDate === newDate) return;
      setCart((prev) => {
        const target = prev.find(
          (it) => it.upsellId === upsellId && it.serviceDate === oldDate,
        );
        if (!target) return prev;
        const dupIdx = prev.findIndex(
          (it) => it.upsellId === upsellId && it.serviceDate === newDate,
        );
        if (dupIdx >= 0) {
          // Fusionar: sumar cantidad al item existente, quitar el que movemos.
          return prev
            .map((it, i) =>
              i === dupIdx ? { ...it, quantity: it.quantity + target.quantity } : it,
            )
            .filter(
              (it) => !(it.upsellId === upsellId && it.serviceDate === oldDate),
            );
        }
        return prev.map((it) =>
          it.upsellId === upsellId && it.serviceDate === oldDate
            ? { ...it, serviceDate: newDate }
            : it,
        );
      });
      // Si el error rojo estaba mostrando "elegí otra fecha", limpiarlo en
      // cuanto el huésped corrige — sino queda hasta el próximo submit y
      // confunde.
      setOrderError(null);
    },
    [],
  );

  // Lookup rápido de upsells por id para resolver cutoff_hours del cart
  // sin tener que pasar el array completo a cada CartLine.
  const experiencesById = useMemo(() => {
    const m = new Map<string, HubUpsell>();
    for (const e of experiences) m.set(e.id, e);
    return m;
  }, [experiences]);

  // ── Crear orden + redirigir a página de pago ──
  // Solo cuando paypalEnabled. Valida que guestName esté completo (server lo
  // re-valida igual, pero corregimos UX antes de pegar al endpoint).
  const handlePayOnline = useCallback(async () => {
    if (creatingOrder || cart.length === 0) return;
    if (!guestName.trim()) {
      setOrderError(
        lang === "es"
          ? "Tu nombre es requerido para crear la orden."
          : "Your name is required to create the order.",
      );
      return;
    }
    setOrderError(null);
    setCreatingOrder(true);
    try {
      const r = await fetch(`/api/public/hub/${encodeURIComponent(hostId)}/service-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestName: guestName.trim(),
          guestEmail: guestEmail.trim() || null,
          guestPhone: guestPhone.trim() || null,
          items: cart.map((it) => ({
            upsellId: it.upsellId,
            quantity: it.quantity,
            serviceDate: it.serviceDate,
            serviceTime: it.serviceTime,
            pickupLocation: it.pickupLocation,
            flightNumber: it.flightNumber,
            extraNotes: it.extraNotes,
          })),
        }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        orderId?: string;
        customerToken?: string;
        error?: string;
      };
      if (!r.ok || !j.ok || !j.orderId || !j.customerToken) {
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      // Limpiamos el carrito antes de redirigir — la orden ya está en BD.
      // Si el huésped cancela el pago, ve la página de la orden con resumen.
      setCart([]);
      saveCart(hostId, []);
      window.location.href = `/hub/${encodeURIComponent(hostId)}/orden/${encodeURIComponent(
        j.orderId,
      )}?t=${encodeURIComponent(j.customerToken)}`;
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : "Error creando orden");
    } finally {
      setCreatingOrder(false);
    }
  }, [cart, creatingOrder, guestName, guestEmail, guestPhone, hostId, lang]);

  // ── WhatsApp template ──
  const whatsappMessage = useMemo(() => {
    const lines: string[] = [];
    lines.push(
      lang === "es"
        ? `Hola ${hostName}! Quiero solicitar estos servicios:`
        : `Hi ${hostName}! I'd like to request these services:`,
    );
    lines.push("");
    for (const it of cart) {
      const suffix = PRICING_SUFFIX[it.pricingModel];
      const qtyLabel = suffix ? `× ${it.quantity} ${suffix}${it.quantity > 1 ? "s" : ""}` : "";
      const total = formatMoney(it.quantity * it.unitPrice, it.currency);
      const date = it.serviceDate ? ` (${it.serviceDate})` : "";
      lines.push(`• ${it.name}${date} ${qtyLabel} — ${total}`);
    }
    lines.push("");
    lines.push(
      `${lang === "es" ? "Total" : "Total"}: ${formatMoney(cartTotal, cart[0]?.currency ?? "USD")}`,
    );
    lines.push("");
    if (guestName) lines.push(`${lang === "es" ? "Mi nombre" : "My name"}: ${guestName}`);
    if (guestPhone) lines.push(`${lang === "es" ? "Mi WhatsApp" : "My WhatsApp"}: ${guestPhone}`);
    lines.push("");
    lines.push(
      lang === "es"
        ? "¿Cómo procedemos con el pago?"
        : "How do we proceed with payment?",
    );
    return lines.join("\n");
  }, [cart, cartTotal, hostName, guestName, guestPhone, lang]);

  const whatsappLink = useMemo(() => {
    if (!hostWhatsapp) return null;
    const digits = hostWhatsapp.replace(/\D/g, "");
    return `https://wa.me/${digits}?text=${encodeURIComponent(whatsappMessage)}`;
  }, [hostWhatsapp, whatsappMessage]);

  // ── Render ──
  if (experiences.length === 0) {
    // Empty state: si el host aún no cargó productos, no mostramos sección.
    // Mejor que el huésped no vea "Sin productos disponibles" hueco.
    return null;
  }

  return (
    <>
      <section id="experiencias" className="py-24 bg-white border-y border-slate-100">
        <div className="max-w-7xl mx-auto px-6">
          <div className="mb-12 text-center max-w-2xl mx-auto">
            <Badge variant="outline" className="text-amber-600 border-amber-600/30 bg-amber-50 mb-4 px-4 py-1 text-sm">
              {lang === "es" ? "Servicios exclusivos" : "Exclusive services"}
            </Badge>
            <h2 className="text-4xl font-bold text-slate-900 mb-4">
              {lang === "es" ? "Mejorá tu estadía" : "Enhance your stay"}
            </h2>
            <p className="text-slate-600 text-lg">
              {lang === "es"
                ? "Excursiones, transporte y servicios para que aproveches al máximo tu viaje."
                : "Excursions, transport and services to make the most of your trip."}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {experiences.map((exp) => {
              const suffix = PRICING_SUFFIX[exp.pricingModel];
              return (
                <button
                  key={exp.id}
                  type="button"
                  onClick={() => setDetailOpen(exp)}
                  className="group text-left relative overflow-hidden rounded-3xl bg-slate-50 border border-slate-100 hover:border-amber-200 hover:shadow-xl transition-all duration-300 cursor-pointer"
                >
                  {/* Foto principal — si no hay, gradient + ícono por categoría */}
                  {exp.heroPhoto ? (
                    <div className="relative aspect-[4/3] overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={exp.heroPhoto}
                        alt={exp.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        loading="lazy"
                      />
                      <Badge className="absolute top-3 left-3 bg-white/90 text-slate-900 text-[10px] uppercase tracking-wider">
                        {CATEGORY_LABEL[exp.category] ?? exp.category}
                      </Badge>
                    </div>
                  ) : (
                    <div className="relative">
                      <CategoryHero
                        category={exp.category}
                        iconName={exp.iconName}
                        size="card"
                      />
                      <Badge className="absolute top-3 left-3 bg-white/90 text-slate-900 text-[10px] uppercase tracking-wider">
                        {CATEGORY_LABEL[exp.category] ?? exp.category}
                      </Badge>
                    </div>
                  )}

                  <div className="p-6 flex flex-col gap-3">
                    <div>
                      <h3 className="font-bold text-xl text-slate-900 mb-1 line-clamp-1">{exp.name}</h3>
                      {exp.description && (
                        <p className="text-slate-500 text-sm leading-relaxed line-clamp-2 min-h-[40px]">
                          {exp.description}
                        </p>
                      )}
                    </div>

                    {exp.vendor && (
                      <p className="text-[11px] text-slate-400 flex items-center gap-1">
                        <Store className="h-3 w-3" /> {exp.vendor.name}
                      </p>
                    )}

                    <div className="flex items-center justify-between pt-3 border-t border-slate-200">
                      <div>
                        <span className="text-2xl font-extrabold text-slate-900">
                          {formatMoney(exp.price, exp.currency)}
                        </span>
                        {suffix && (
                          <span className="text-slate-500 text-sm ml-1">/ {suffix}</span>
                        )}
                      </div>
                      <span className="text-xs font-bold text-amber-600 group-hover:underline">
                        {lang === "es" ? "Ver detalle →" : "Details →"}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Floating cart button — sólo si hay items */}
      {cartCount > 0 && (
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          className="fixed bottom-6 right-6 z-40 h-14 px-5 rounded-full bg-amber-500 hover:bg-amber-600 text-white shadow-2xl flex items-center gap-2 font-bold transition-transform hover:scale-105"
        >
          <ShoppingCart className="h-5 w-5" />
          <span>{cartCount}</span>
          <span className="ml-1 text-sm font-semibold opacity-90">
            {formatMoney(cartTotal, cart[0]?.currency ?? "USD")}
          </span>
        </button>
      )}

      {/* Detail modal */}
      {detailOpen && (
        <UpsellDetail
          upsell={detailOpen}
          lang={lang}
          onClose={() => setDetailOpen(null)}
          onAdd={(item) => {
            addToCart(item);
            setDetailOpen(null);
            setCartOpen(true);
          }}
        />
      )}

      {/* Cart drawer */}
      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {lang === "es" ? "Tu carrito" : "Your cart"}
            </SheetTitle>
            <SheetDescription>
              {lang === "es"
                ? "Revisá tu selección y enviá la solicitud al host."
                : "Review your selection and send the request to the host."}
            </SheetDescription>
          </SheetHeader>

          {cart.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <ShoppingCart className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">
                {lang === "es" ? "Aún no agregaste nada." : "Nothing in your cart yet."}
              </p>
            </div>
          ) : (
            <div className="space-y-3 mt-6">
              {cart.map((it) => {
                const suffix = PRICING_SUFFIX[it.pricingModel];
                // Cutoff del upsell — necesario para calcular fecha mínima
                // editable. Si el upsell ya no está en el catálogo del hub
                // (raro, lo deshabilitaron mid-sesión), permitimos hoy.
                const exp = experiencesById.get(it.upsellId);
                const cutoffHours = exp?.cutoffHours ?? 0;
                const minDate = getMinServiceDate(cutoffHours);
                const dateRequired = cutoffHours > 0;
                return (
                  <div
                    key={`${it.upsellId}-${it.serviceDate ?? "no-date"}`}
                    className="flex items-start gap-3 p-3 border rounded-xl"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{it.name}</p>
                      {/* Fecha editable inline. Antes era texto plano, lo que
                          obligaba al huésped a quitar el item y re-agregarlo
                          si el server rechazaba por cutoff. */}
                      <div className="mt-1 flex items-center gap-1">
                        <Input
                          type="date"
                          value={it.serviceDate ?? ""}
                          min={minDate}
                          onChange={(e) =>
                            updateServiceDate(
                              it.upsellId,
                              it.serviceDate,
                              e.target.value || null,
                            )
                          }
                          className="h-7 text-[11px] px-2 py-0 w-auto"
                        />
                        {dateRequired && !it.serviceDate && (
                          <span className="text-[10px] text-amber-600">
                            {lang === "es" ? "fecha requerida" : "date required"}
                          </span>
                        )}
                      </div>
                      {/* Sprint 5 — display de los datos extras capturados */}
                      {(it.serviceTime || it.pickupLocation || it.flightNumber || it.extraNotes) && (
                        <div className="mt-1.5 space-y-0.5 text-[10px] text-slate-500 leading-tight">
                          {it.serviceTime && <p>🕒 {it.serviceTime}</p>}
                          {it.pickupLocation && (
                            <p className="line-clamp-1">📍 {it.pickupLocation}</p>
                          )}
                          {it.flightNumber && <p className="font-mono">✈️ {it.flightNumber}</p>}
                          {it.extraNotes && (
                            <p className="line-clamp-2 italic">💬 {it.extraNotes}</p>
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <button
                          type="button"
                          onClick={() => updateQty(it.upsellId, it.serviceDate, -1)}
                          className="h-7 w-7 rounded-full border flex items-center justify-center hover:bg-slate-50"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="text-sm font-medium w-12 text-center">
                          {it.quantity} {suffix}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateQty(it.upsellId, it.serviceDate, +1)}
                          className="h-7 w-7 rounded-full border flex items-center justify-center hover:bg-slate-50"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-sm">
                        {formatMoney(it.unitPrice * it.quantity, it.currency)}
                      </p>
                      <button
                        type="button"
                        onClick={() => removeItem(it.upsellId, it.serviceDate)}
                        className="text-rose-500 text-xs mt-1 hover:underline flex items-center gap-1"
                      >
                        <X className="h-3 w-3" /> {lang === "es" ? "Quitar" : "Remove"}
                      </button>
                    </div>
                  </div>
                );
              })}

              <div className="flex items-center justify-between pt-4 border-t font-bold text-lg">
                <span>{lang === "es" ? "Total" : "Total"}</span>
                <span>{formatMoney(cartTotal, cart[0]?.currency ?? "USD")}</span>
              </div>

              <div className="space-y-3 pt-4 border-t">
                <div className="space-y-1">
                  <Label className="text-xs">
                    {lang === "es" ? "Tu nombre *" : "Your name *"}
                  </Label>
                  <Input
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    placeholder={lang === "es" ? "Ej: María López" : "Ex: Mary Smith"}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">
                      {lang === "es" ? "WhatsApp" : "WhatsApp"}
                    </Label>
                    <Input
                      value={guestPhone}
                      onChange={(e) => setGuestPhone(e.target.value)}
                      placeholder="+1 809..."
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">
                      {lang === "es" ? "Email" : "Email"}
                    </Label>
                    <Input
                      type="email"
                      value={guestEmail}
                      onChange={(e) => setGuestEmail(e.target.value)}
                      placeholder="tu@email.com"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          <SheetFooter className="mt-6 flex-col sm:flex-col gap-2">
            {/* Opción A — Pago online si el host tiene PayPal */}
            {paypalEnabled && (
              <>
                <Button
                  type="button"
                  disabled={cart.length === 0 || creatingOrder}
                  onClick={handlePayOnline}
                  className="w-full gradient-gold text-white"
                >
                  {creatingOrder
                    ? (lang === "es" ? "Creando orden..." : "Creating order...")
                    : (lang === "es" ? "Pagar online con PayPal" : "Pay online with PayPal")}
                </Button>
                {orderError && (
                  <p className="text-[11px] text-rose-600 text-center">{orderError}</p>
                )}
                {whatsappLink && (
                  <div className="flex items-center gap-2 my-1">
                    <div className="flex-1 h-px bg-slate-200" />
                    <span className="text-[10px] text-slate-400 uppercase">
                      {lang === "es" ? "o" : "or"}
                    </span>
                    <div className="flex-1 h-px bg-slate-200" />
                  </div>
                )}
              </>
            )}

            {/* Opción B — Solicitar al host por WhatsApp (siempre disponible
                si hay número, sirve como fallback cuando no hay PayPal). */}
            {whatsappLink ? (
              <Button
                asChild
                disabled={cart.length === 0}
                variant={paypalEnabled ? "outline" : "default"}
                className={
                  paypalEnabled
                    ? "w-full"
                    : "w-full bg-emerald-600 hover:bg-emerald-700 text-white"
                }
              >
                <a href={whatsappLink} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="h-4 w-4 mr-2" />
                  {lang === "es"
                    ? (paypalEnabled ? "Solicitar por WhatsApp" : "Enviar por WhatsApp")
                    : (paypalEnabled ? "Request via WhatsApp" : "Send via WhatsApp")}
                </a>
              </Button>
            ) : !paypalEnabled ? (
              <Button disabled className="w-full">
                {lang === "es"
                  ? "El host aún no configuró canales de pago"
                  : "Host hasn't set up payment channels yet"}
              </Button>
            ) : null}

            <p className="text-[11px] text-center text-slate-500">
              {paypalEnabled
                ? (lang === "es"
                    ? "Pago seguro vía PayPal. El host coordina los detalles del servicio."
                    : "Secure PayPal payment. Host coordinates service details.")
                : (lang === "es"
                    ? "El host responderá con instrucciones de pago."
                    : "The host will reply with payment instructions.")}
            </p>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

// ─── Detail modal (subcomponente local) ─────────────────────────────────────
interface DetailProps {
  upsell: HubUpsell;
  lang: "es" | "en";
  onClose: () => void;
  onAdd: (item: CartItem) => void;
}

function UpsellDetail({ upsell, lang, onClose, onAdd }: DetailProps) {
  const [quantity, setQuantity] = useState(upsell.minQuantity || 1);
  const [serviceDate, setServiceDate] = useState("");
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);

  // Sprint 5 — campos dinámicos según los flags del upsell. Default vacío;
  // se validan abajo en `canAdd` solo si requires_X=true.
  const [serviceTime, setServiceTime] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  const [flightNumber, setFlightNumber] = useState("");
  const [extraNotes, setExtraNotes] = useState("");

  const photos = useMemo(() => {
    const list: string[] = [];
    if (upsell.heroPhoto) list.push(upsell.heroPhoto);
    for (const g of upsell.galleryPhotos) {
      if (g && !list.includes(g)) list.push(g);
    }
    return list;
  }, [upsell.heroPhoto, upsell.galleryPhotos]);

  const suffix = PRICING_SUFFIX[upsell.pricingModel];
  const subtotal = upsell.pricingModel === "fixed" ? upsell.price : upsell.price * quantity;
  const max = upsell.maxQuantity ?? 99;
  const min = upsell.minQuantity || 1;

  // Para fechas: la mínima es hoy + cutoffHours.
  const minDate = getMinServiceDate(upsell.cutoffHours);

  // Validación de "agregar":
  //   - cantidad dentro del rango (per_X) o producto fijo
  //   - fecha del servicio cuando el upsell tiene cutoff (vendor necesita
  //     saber para cuándo). Productos sin cutoff (lavandería on-demand)
  //     permiten fecha vacía.
  const quantityOk = upsell.pricingModel === "fixed" || (quantity >= min && quantity <= max);
  const dateOk = upsell.cutoffHours === 0 || !!serviceDate;
  // Sprint 5 — solo bloqueamos cuando el field es "required" Y está vacío.
  // Si es "optional", el huésped puede dejar el input vacío y seguir.
  const timeOk = upsell.timeField !== "required" || !!serviceTime;
  const pickupOk = upsell.pickupField !== "required" || pickupLocation.trim().length > 0;
  const flightOk = upsell.flightField !== "required" || flightNumber.trim().length > 0;
  const canAdd = quantityOk && dateOk && timeOk && pickupOk && flightOk;

  return (
    <Sheet open={true} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{upsell.name}</SheetTitle>
          {upsell.vendor && (
            <SheetDescription className="flex items-center gap-2">
              <Store className="h-3 w-3" /> {lang === "es" ? "Por" : "By"} {upsell.vendor.name}
            </SheetDescription>
          )}
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Galería con foto activa + thumbs. Sin fotos → category hero. */}
          {photos.length > 0 ? (
            <div className="space-y-2">
              <div className="aspect-[16/10] rounded-2xl overflow-hidden bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photos[activePhotoIdx]}
                  alt={upsell.name}
                  className="w-full h-full object-cover"
                />
              </div>
              {photos.length > 1 && (
                <div className="flex gap-2 overflow-x-auto">
                  {photos.map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setActivePhotoIdx(i)}
                      className={`h-16 w-16 rounded-lg overflow-hidden border-2 shrink-0 ${
                        i === activePhotoIdx ? "border-amber-500" : "border-transparent opacity-60"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl overflow-hidden">
              <CategoryHero
                category={upsell.category}
                iconName={upsell.iconName}
                size="detail"
              />
            </div>
          )}

          {upsell.description && (
            <div>
              <h4 className="font-semibold mb-2">
                {lang === "es" ? "Descripción" : "Description"}
              </h4>
              <p className="text-sm text-slate-600 whitespace-pre-wrap">{upsell.description}</p>
            </div>
          )}

          {/* Precio + selector de cantidad */}
          <div className="p-4 bg-amber-50/50 rounded-2xl border border-amber-200/50 space-y-4">
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-extrabold text-slate-900">
                {formatMoney(upsell.price, upsell.currency)}
              </span>
              {suffix && (
                <span className="text-slate-500 text-sm">/ {suffix}</span>
              )}
            </div>

            {upsell.pricingModel !== "fixed" && (
              <div className="space-y-2">
                <Label className="text-xs">
                  {lang === "es" ? "Cantidad" : "Quantity"}{" "}
                  ({suffix}
                  {min > 1 ? `, mín ${min}` : ""}
                  {upsell.maxQuantity ? `, máx ${upsell.maxQuantity}` : ""})
                </Label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setQuantity(Math.max(min, quantity - 1))}
                    className="h-10 w-10 rounded-lg border bg-white flex items-center justify-center hover:bg-slate-50"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <Input
                    type="number"
                    value={quantity}
                    min={min}
                    max={max}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) setQuantity(Math.max(min, Math.min(max, v)));
                    }}
                    className="w-20 text-center text-lg font-bold"
                  />
                  <button
                    type="button"
                    onClick={() => setQuantity(Math.min(max, quantity + 1))}
                    className="h-10 w-10 rounded-lg border bg-white flex items-center justify-center hover:bg-slate-50"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <div className="ml-auto text-right">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider">
                      Subtotal
                    </p>
                    <p className="text-xl font-extrabold">
                      {formatMoney(subtotal, upsell.currency)}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs">
                {lang === "es" ? "Fecha del servicio" : "Service date"}
                {upsell.cutoffHours > 0 && (
                  <span className="text-amber-600 ml-1">
                    {lang === "es" ? "(requerida)" : "(required)"}
                  </span>
                )}
              </Label>
              <Input
                type="date"
                value={serviceDate}
                min={minDate}
                onChange={(e) => setServiceDate(e.target.value)}
              />
              {upsell.cutoffHours > 0 && (
                <p className="text-[11px] text-slate-500">
                  {lang === "es"
                    ? `Se cierra ${upsell.cutoffHours}h antes del servicio`
                    : `Closes ${upsell.cutoffHours}h before service`}
                </p>
              )}
            </div>

            {/* Sprint 5 — campos dinámicos. Mostramos cuando field != "off".
                Marcamos "(requerida)" en amber solo si "required"; "(opcional)"
                en slate si "optional". */}
            {(() => {
              const requiredLabel = lang === "es" ? "(requerida)" : "(required)";
              const optionalLabel = lang === "es" ? "(opcional)" : "(optional)";
              const renderRequiredHint = (state: FieldVisibility) => {
                if (state === "required")
                  return <span className="text-amber-600 ml-1">{requiredLabel}</span>;
                if (state === "optional")
                  return <span className="text-slate-400 ml-1">{optionalLabel}</span>;
                return null;
              };
              return (
                <>
                  {upsell.timeField !== "off" && (
                    <div className="space-y-2">
                      <Label className="text-xs">
                        🕒 {lang === "es" ? "Hora del servicio" : "Service time"}
                        {renderRequiredHint(upsell.timeField)}
                      </Label>
                      <Input
                        type="time"
                        value={serviceTime}
                        onChange={(e) => setServiceTime(e.target.value)}
                      />
                    </div>
                  )}

                  {upsell.pickupField !== "off" && (
                    <div className="space-y-2">
                      <Label className="text-xs">
                        📍 {lang === "es" ? "Punto de recogida" : "Pickup location"}
                        {renderRequiredHint(upsell.pickupField)}
                      </Label>
                      <Input
                        value={pickupLocation}
                        onChange={(e) => setPickupLocation(e.target.value)}
                        placeholder={
                          lang === "es"
                            ? "Ej: Hotel Riu Bávaro, lobby principal"
                            : "Ex: Hotel Riu Bávaro, main lobby"
                        }
                        maxLength={500}
                      />
                    </div>
                  )}

                  {upsell.flightField !== "off" && (
                    <div className="space-y-2">
                      <Label className="text-xs">
                        ✈️ {lang === "es" ? "Número de vuelo" : "Flight number"}
                        {renderRequiredHint(upsell.flightField)}
                      </Label>
                      <Input
                        value={flightNumber}
                        onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
                        placeholder="AA1234"
                        maxLength={10}
                        className="uppercase font-mono"
                      />
                      <p className="text-[10px] text-slate-500">
                        {lang === "es"
                          ? "Te seguimos el vuelo en tiempo real para coordinar el recojo."
                          : "We'll track the flight in real time to coordinate the pickup."}
                      </p>
                    </div>
                  )}
                </>
              );
            })()}

            {upsell.notesPlaceholder && (
              <div className="space-y-2">
                <Label className="text-xs">
                  💬 {lang === "es" ? "Notas adicionales" : "Extra notes"}
                  <span className="text-slate-400 ml-1">
                    {lang === "es" ? "(opcional)" : "(optional)"}
                  </span>
                </Label>
                <textarea
                  value={extraNotes}
                  onChange={(e) => setExtraNotes(e.target.value)}
                  placeholder={upsell.notesPlaceholder}
                  maxLength={1000}
                  rows={3}
                  className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                />
              </div>
            )}
          </div>
        </div>

        <SheetFooter className="mt-6">
          <Button
            type="button"
            disabled={!canAdd}
            onClick={() =>
              onAdd({
                upsellId: upsell.id,
                name: upsell.name,
                pricingModel: upsell.pricingModel,
                unitPrice: upsell.price,
                quantity: upsell.pricingModel === "fixed" ? 1 : quantity,
                currency: upsell.currency,
                serviceDate: serviceDate || null,
                serviceTime: serviceTime || null,
                pickupLocation: pickupLocation.trim() || null,
                flightNumber: flightNumber.trim() || null,
                extraNotes: extraNotes.trim() || null,
              })
            }
            className="w-full gradient-gold text-white"
          >
            <ShoppingCart className="h-4 w-4 mr-2" />
            {lang === "es"
              ? `Agregar al carrito · ${formatMoney(subtotal, upsell.currency)}`
              : `Add to cart · ${formatMoney(subtotal, upsell.currency)}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
