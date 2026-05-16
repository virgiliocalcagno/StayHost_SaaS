"use client";

// Hub "Tienda Local": variante del hub público sin sección de Alojamientos.
//
// Para qué sirve:
//   - El host comparte ESTE link con huéspedes que YA reservaron por Airbnb,
//     Booking, VRBO o directo. Esos huéspedes no necesitan ver las
//     propiedades — solo quieren contratar excursiones, transporte, comida.
//   - También sirve para turistas locales que llegan al destino y quieren
//     servicios sin haber reservado nunca alojamiento con el host.
//
// Reutiliza:
//   - Mismo endpoint /api/public/hub/[hostId] (devuelve properties + experiences;
//     acá ignoramos properties)
//   - Mismo componente UpsellExperiences (catálogo + carrito + PayPal/WhatsApp)
//
// Diferencias vs /hub/[hostId]:
//   - Sin sección "Alojamientos" ni buscador de fechas
//   - Hero con imagen + gradient (no compacto/plano)
//   - Sections de marketing: categorías, cómo funciona, por qué nosotros
//   - Empty state propio si el host no tiene experiencias cargadas

import { use, useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Globe,
  Home,
  ShoppingBag,
  Mail,
  MessageCircle,
  ShieldCheck,
  HeadphonesIcon,
  Heart,
  Sparkles,
  ChevronRight,
  User,
} from "lucide-react";
import { useLanguage } from "../../LanguageContext";
import UpsellExperiences from "../UpsellExperiences";
import {
  getUpsellIcon,
  getCategoryGradient,
  getCategoryIconColor,
} from "@/lib/upsell/categoryVisuals";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import GuestAuthModal from "@/components/auth/GuestAuthModal";

type PricingModel = "fixed" | "per_person" | "per_unit" | "per_kg" | "per_night";

interface StoredUpsell {
  id: string;
  name: string;
  description: string | null;
  nameEn: string | null;
  descriptionEn: string | null;
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
  // Sprint 5 — visibility por campo (off / optional / required)
  timeField: "off" | "optional" | "required";
  pickupField: "off" | "optional" | "required";
  flightField: "off" | "optional" | "required";
  notesPlaceholder: string | null;
  isGlobal: boolean;
  linkedPropertyIds: string[];
  vendor: { name: string; photo: string | null } | null;
}

// Mapeo categoría → key de translation del LanguageContext.
const CATEGORY_TKEY: Record<string, string> = {
  excursion: "catExcursion",
  transport: "catTransport",
  food: "catFood",
  laundry: "catLaundry",
  spa: "catSpa",
  concierge: "catConcierge",
  rental: "catRental",
  connectivity: "catConnectivity",
  service: "catService",
  other: "catOther",
};

// Imagen hero ya verificada en el codebase (misma que usa el hub completo).
const DEFAULT_HERO_IMAGE =
  "https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?q=80&w=2070&auto=format&fit=crop";
const DEFAULT_LOGO =
  "https://images.unsplash.com/photo-1541462608143-67571c6738dd?w=150&h=150&fit=crop";

export default function HubExtrasPage({ params }: { params: Promise<{ hostId: string }> }) {
  const resolvedParams = use(params);
  const hostId = resolvedParams.hostId;
  const { lang, toggleLang, t } = useLanguage();

  const [hubName, setHubName] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState<string | null>(null);
  const [hubLogo, setHubLogo] = useState<string | null>(null);
  const [contactEmail, setContactEmail] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);
  const [paypalEnabled, setPaypalEnabled] = useState(false);
  const [experiences, setExperiences] = useState<StoredUpsell[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Sprint 8a — estado del huésped logueado.
  const [guestEmail, setGuestEmail] = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  // Detectar sesión actual del huésped (si la hay).
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email) setGuestEmail(user.email);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setGuestEmail(session?.user?.email ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    fetch(`/api/public/hub/${encodeURIComponent(hostId)}`, { cache: "no-store" })
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((data) => {
        if (!data) return;
        if (data?.hub?.name) setHubName(data.hub.name);
        if (data?.hub?.welcomeMessage) setWelcomeMessage(data.hub.welcomeMessage);
        if (data?.hub?.logo) setHubLogo(data.hub.logo);
        if (data?.hub?.contactEmail) setContactEmail(data.hub.contactEmail);
        if (data?.hub?.whatsapp) setWhatsapp(data.hub.whatsapp);
        if (data?.hub?.paymentMethods?.paypal) setPaypalEnabled(true);
        if (Array.isArray(data?.experiences)) setExperiences(data.experiences);
        // Ignoramos data.properties a propósito — esta página NO muestra
        // alojamientos. El hub completo está en /hub/[hostId].
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [hostId]);

  // Categorías presentes en el catálogo del host. Mostramos pills solo
  // para categorías con al menos 1 producto activo — evita mostrar
  // "Spa (0)" como pill muerta.
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of experiences) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([cat, count]) => ({ cat, count }))
      .sort((a, b) => b.count - a.count);
  }, [experiences]);

  const whatsappLink = whatsapp ? `https://wa.me/${whatsapp.replace(/\D/g, "")}` : null;
  const logoSrc = hubLogo || DEFAULT_LOGO;
  const displayName = hubName || (lang === "es" ? "Tu host local" : "Your local host");

  if (notFound) {
    return (
      <main className="min-h-screen bg-[#FDFBF7] flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <Home className="h-16 w-16 mx-auto mb-4 text-slate-300" />
          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            {lang === "es" ? "Hub no encontrado" : "Hub not found"}
          </h1>
          <p className="text-slate-600">
            {lang === "es"
              ? "El enlace que abriste no corresponde a un host activo. Verificá la URL con quien te la compartió."
              : "The link you opened doesn't match an active host. Verify the URL with whoever shared it."}
          </p>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#FDFBF7] flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-500 font-medium">
          <Sparkles className="h-5 w-5 animate-pulse text-amber-500" />
          {lang === "es" ? "Cargando tienda..." : "Loading shop..."}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#FDFBF7] text-slate-800 font-sans selection:bg-amber-200">
      {/* ── NAV sticky con logo + idioma ──────────────────────────────── */}
      <nav className="sticky top-0 inset-x-0 z-50 px-6 py-3 flex items-center justify-between backdrop-blur-md bg-white/80 border-b border-slate-100 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoSrc}
            alt={displayName}
            className="w-10 h-10 rounded-full object-cover shadow-md border-2 border-white shrink-0"
          />
          <span className="font-bold text-lg md:text-xl tracking-tight text-slate-900 truncate">
            {displayName}
          </span>
          <Badge variant="outline" className="hidden md:inline-flex ml-1 text-[10px] text-amber-700 border-amber-200 bg-amber-50">
            <ShoppingBag className="w-3 h-3 mr-1" /> {t("shopBadge")}
          </Badge>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Sprint 8a — botón cuenta. Si está logueado, va a /cuenta;
              si no, abre el modal de login. */}
          {guestEmail ? (
            <Link
              href="/cuenta"
              className="flex items-center gap-1.5 px-3 h-9 rounded-full bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-800 font-semibold text-sm transition-colors"
              title={guestEmail}
            >
              <User className="w-4 h-4" />
              <span className="hidden sm:inline">Mi cuenta</span>
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="flex items-center gap-1.5 px-3 h-9 rounded-full border border-slate-200 bg-white hover:bg-slate-50 font-semibold text-sm transition-colors"
            >
              <User className="w-4 h-4 text-slate-500" />
              <span className="hidden sm:inline">{lang === "es" ? "Iniciar sesión" : "Sign in"}</span>
            </button>
          )}
          {/* Idioma — visible y claro con bandera/código.
              Sticky para que el huésped lo encuentre rápido al scrollear. */}
          <button
            type="button"
            onClick={toggleLang}
            className="flex items-center gap-2 px-3 h-9 rounded-full border border-slate-200 bg-white hover:bg-slate-50 transition-colors font-semibold text-sm"
            aria-label="Cambiar idioma / Change language"
          >
            <Globe className="w-4 h-4 text-slate-500" />
            <span className="uppercase tracking-wide">{lang}</span>
            <span className="text-slate-400">·</span>
            <span className="text-slate-500 text-xs">{lang === "es" ? "EN" : "ES"}</span>
          </button>
        </div>
      </nav>

      {/* ── HERO con imagen + gradient ───────────────────────────────── */}
      {/* No usamos altura fija (causaba que la stats bar absoluta pisara los
          CTAs en pantallas ~14"). Ahora el contenido fluye y la stats bar
          vive en su propia sección con overlap negativo. */}
      <section className="relative pt-20 pb-28 md:pb-36 w-full flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={DEFAULT_HERO_IMAGE} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-[#FDFBF7]" />
        </div>

        <div className="relative z-10 text-center px-6 max-w-3xl">
          <Badge className="bg-white/20 text-white hover:bg-white/30 backdrop-blur-md mb-6 border-white/40 shadow-xl px-4 py-1.5 text-sm">
            {t("shopBadge")}
          </Badge>
          <h1 className="text-4xl md:text-6xl font-extrabold text-white mb-5 drop-shadow-2xl tracking-tight leading-tight">
            {lang === "es" ? (
              <>
                La <span className="text-amber-300">tienda local</span> de
                <br className="hidden sm:block" /> {displayName}
              </>
            ) : (
              <>
                <span className="text-amber-300">{displayName}&apos;s</span>
                <br className="hidden sm:block" /> local shop
              </>
            )}
          </h1>
          <p className="text-base md:text-xl text-white/95 font-medium max-w-2xl mx-auto drop-shadow-lg">
            {t("shopSubGeneric")}
          </p>

          {/* CTA primario hacia las experiencias (anchor scroll) */}
          {experiences.length > 0 && (
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                asChild
                className="gradient-gold text-white rounded-full px-8 py-6 h-auto font-bold text-base shadow-2xl border-none hover:scale-105 transition-transform"
              >
                <a href="#experiencias">
                  <ShoppingBag className="w-4 h-4 mr-2" />
                  {lang === "es" ? "Ver catálogo" : "View catalog"}
                </a>
              </Button>
              {whatsappLink && (
                <Button
                  asChild
                  variant="outline"
                  className="bg-white/10 border-white/40 text-white hover:bg-white/20 backdrop-blur-md rounded-full px-8 py-6 h-auto font-bold text-base"
                >
                  <a href={whatsappLink} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="w-4 h-4 mr-2" />
                    {lang === "es" ? "Hablanos por WhatsApp" : "Chat on WhatsApp"}
                  </a>
                </Button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── STATS BAR — float card con overlap negativo sobre el hero ─── */}
      <section className="relative z-20 -mt-16 md:-mt-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="bg-white/98 backdrop-blur rounded-2xl shadow-2xl border border-slate-100 px-4 py-5 md:px-8 md:py-6 grid grid-cols-3 divide-x divide-slate-200">
            <div className="text-center px-2">
              <p className="text-2xl md:text-3xl font-extrabold text-amber-600">
                {experiences.length}
                {experiences.length >= 10 ? "+" : ""}
              </p>
              <p className="text-[10px] md:text-xs text-slate-600 font-semibold mt-1">
                {t("shopStatActivities")}
              </p>
            </div>
            <div className="text-center px-2">
              <p className="text-2xl md:text-3xl font-extrabold text-emerald-600">24/7</p>
              <p className="text-[10px] md:text-xs text-slate-600 font-semibold mt-1">
                {t("shopStat247")}
              </p>
            </div>
            <div className="text-center px-2 flex flex-col items-center justify-center">
              <ShieldCheck className="w-5 h-5 md:w-6 md:h-6 text-blue-600 mb-1" />
              <p className="text-[10px] md:text-xs text-slate-600 font-semibold">
                {t("shopStatSecure")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── MENSAJE DE BIENVENIDA opcional del host ──────────────────── */}
      {welcomeMessage && (
        <section className="py-12 px-6 max-w-3xl mx-auto text-center">
          <p className="text-lg md:text-xl text-slate-700 leading-relaxed font-medium italic">
            &ldquo;{welcomeMessage}&rdquo;
          </p>
          <p className="text-sm text-slate-500 mt-3 not-italic">— {displayName}</p>
        </section>
      )}

      {/* ── CATEGORÍAS SHOWCASE ──────────────────────────────────────── */}
      {categories.length > 0 && (
        <section className="py-16 px-6 max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-3">
              {t("shopBrowseCategories")}
            </h2>
            <p className="text-slate-600 max-w-2xl mx-auto">{t("shopCategorySub")}</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
            {categories.map(({ cat, count }) => {
              const Icon = getUpsellIcon(cat);
              const gradient = getCategoryGradient(cat);
              const iconColor = getCategoryIconColor(cat);
              const tkey = CATEGORY_TKEY[cat] ?? "catOther";
              return (
                <a
                  key={cat}
                  href="#experiencias"
                  className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${gradient} p-5 hover:shadow-lg hover:scale-[1.03] transition-all duration-300 border border-white/40`}
                >
                  <Icon className={`w-8 h-8 ${iconColor} mb-3 opacity-90`} />
                  <p className="font-bold text-slate-900 text-sm md:text-base">{t(tkey)}</p>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    {count} {count === 1 ? (lang === "es" ? "opción" : "option") : (lang === "es" ? "opciones" : "options")}
                  </p>
                  <ChevronRight className={`absolute bottom-3 right-3 w-4 h-4 ${iconColor} opacity-0 group-hover:opacity-100 transition-opacity`} />
                </a>
              );
            })}
          </div>
        </section>
      )}

      {/* ── EXPERIENCIAS (catálogo) o EMPTY STATE ────────────────────── */}
      <div id="experiencias">
        {experiences.length === 0 ? (
          <section className="px-6 py-24 text-center max-w-lg mx-auto">
            <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-6">
              <ShoppingBag className="h-10 w-10 text-amber-600" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-3">{t("shopEmptyTitle")}</h2>
            <p className="text-slate-600 leading-relaxed">{t("shopEmptyDesc")}</p>
            {whatsappLink && (
              <Button asChild className="mt-8 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full px-6 py-6 h-auto shadow-md">
                <a href={whatsappLink} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="w-4 h-4" />
                  {t("contactUs")}
                </a>
              </Button>
            )}
          </section>
        ) : (
          <UpsellExperiences
            hostId={hostId}
            hostName={displayName}
            hostWhatsapp={whatsapp}
            experiences={experiences}
            lang={lang}
            paypalEnabled={paypalEnabled}
          />
        )}
      </div>

      {/* ── CÓMO FUNCIONA — 3 steps ──────────────────────────────────── */}
      {experiences.length > 0 && (
        <section className="py-20 px-6 bg-white">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-14">
              <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200 mb-3">
                {t("shopHowItWorks")}
              </Badge>
              <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-2">
                {t("shopHowItWorks")}
              </h2>
              <p className="text-slate-600">{t("shopHowSub")}</p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              {[
                { num: "1", title: "shopStep1Title", desc: "shopStep1Desc" },
                { num: "2", title: "shopStep2Title", desc: "shopStep2Desc" },
                { num: "3", title: "shopStep3Title", desc: "shopStep3Desc" },
              ].map(({ num, title, desc }) => (
                <div key={num} className="text-center relative">
                  <div className="w-14 h-14 mx-auto mb-5 rounded-full gradient-gold text-white font-extrabold text-xl flex items-center justify-center shadow-lg shadow-amber-500/30">
                    {num}
                  </div>
                  <h3 className="font-bold text-lg text-slate-900 mb-2">{t(title)}</h3>
                  <p className="text-slate-600 text-sm leading-relaxed max-w-xs mx-auto">{t(desc)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── POR QUÉ ELEGIR ESTA TIENDA ──────────────────────────────── */}
      {experiences.length > 0 && (
        <section className="py-20 px-6 bg-gradient-to-br from-amber-50/50 to-orange-50/30">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-14">
              <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-2">
                {t("shopWhyTitle")}
              </h2>
              <p className="text-slate-600">{t("shopWhySub")}</p>
            </div>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                { Icon: Heart, color: "text-rose-600", bg: "bg-rose-100", title: "shopWhy1Title", desc: "shopWhy1Desc" },
                { Icon: HeadphonesIcon, color: "text-emerald-600", bg: "bg-emerald-100", title: "shopWhy2Title", desc: "shopWhy2Desc" },
                { Icon: ShieldCheck, color: "text-blue-600", bg: "bg-blue-100", title: "shopWhy3Title", desc: "shopWhy3Desc" },
              ].map(({ Icon, color, bg, title, desc }) => (
                <div
                  key={title}
                  className="bg-white rounded-2xl p-7 border border-slate-100 shadow-sm hover:shadow-lg transition-shadow"
                >
                  <div className={`w-12 h-12 rounded-xl ${bg} flex items-center justify-center mb-4`}>
                    <Icon className={`w-6 h-6 ${color}`} />
                  </div>
                  <h3 className="font-bold text-lg text-slate-900 mb-2">{t(title)}</h3>
                  <p className="text-slate-600 text-sm leading-relaxed">{t(desc)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── CONTACTO CTA fuerte ──────────────────────────────────────── */}
      <section className="py-20 px-6 bg-slate-900 text-white">
        <div className="max-w-3xl mx-auto text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoSrc}
            alt={displayName}
            className="w-20 h-20 rounded-full mx-auto mb-6 border-4 border-amber-400/40 object-cover shadow-2xl"
          />
          <h2 className="text-3xl md:text-4xl font-bold mb-3">{t("shopContactTitle")}</h2>
          <p className="text-slate-300 text-lg mb-8 max-w-xl mx-auto">{t("shopContactSub")}</p>
          {(contactEmail || whatsappLink) && (
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              {whatsappLink && (
                <Button
                  asChild
                  size="lg"
                  className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-full px-8 py-6 h-auto font-bold shadow-xl"
                >
                  <a href={whatsappLink} target="_blank" rel="noopener noreferrer">
                    <MessageCircle className="w-5 h-5 mr-2" />
                    WhatsApp
                  </a>
                </Button>
              )}
              {contactEmail && (
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="bg-transparent border-white/30 text-white hover:bg-white/10 rounded-full px-8 py-6 h-auto font-bold"
                >
                  <a href={`mailto:${contactEmail}`}>
                    <Mail className="w-5 h-5 mr-2" />
                    {contactEmail}
                  </a>
                </Button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── FOOTER discreto ──────────────────────────────────────────── */}
      <footer className="py-8 px-6 bg-slate-950 text-slate-400 text-center text-xs">
        <p>
          {t("shopFooterLookingStay")}{" "}
          <a
            href={`/hub/${encodeURIComponent(hostId)}`}
            className="underline text-amber-400 hover:text-amber-300"
          >
            {t("shopFooterFullHub")}
          </a>
          .
        </p>
        <p className="mt-2 text-slate-500">
          ✨ {t("shopFooterPowered")}
        </p>
      </footer>

      <GuestAuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} />
    </main>
  );
}
