"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  MapPin,
  Star,
  Car,
  UtensilsCrossed,
  Palmtree,
  ChevronRight,
  Globe,
  Home,
  Sparkles,
} from "lucide-react";
import { useLanguage } from "../LanguageContext";

// ─── Types (matching stayhost_properties & stayhost_upsells shapes) ─────────
interface StoredProperty {
  id: string;
  name: string;
  address?: string;
  city?: string;
  image?: string;
  price?: number;
  rating?: number;
  maxGuests?: number;
  descriptionES?: string;
  descriptionEN?: string;
  status?: string;
}

interface StoredUpsell {
  id: string;
  name: string;
  description?: string;
  price: number;
  category?: string;
  iconName?: string;
  active?: boolean;
  isGlobal?: boolean;
}

// ─── Fallback mock data (shown when localStorage is empty) ──────────────────
const FALLBACK_PROPERTIES: StoredProperty[] = [
  { id: "prop-1", name: "Villa Mar y Sol", city: "Tulum, México", price: 320, rating: 4.9, image: "https://images.unsplash.com/photo-1510798831971-661eb04b3739?w=800&q=80" },
  { id: "prop-2", name: "Loft Centro Histórico", city: "Mérida, México", price: 110, rating: 4.8, image: "https://images.unsplash.com/photo-1502672260266-1c1de2d9668b?w=800&q=80" },
  { id: "prop-3", name: "Casa de la Playa Privada", city: "Riviera Maya, México", price: 550, rating: 5.0, image: "https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?w=800&q=80" },
];

const FALLBACK_UPSELLS: StoredUpsell[] = [
  { id: "e1", name: "Traslado Aeropuerto VIP", price: 85, category: "transport", iconName: "Car" },
  { id: "e2", name: "Desayuno Local Flotante", price: 65, category: "food", iconName: "UtensilsCrossed" },
  { id: "e3", name: "Tour Ruinas Mayas y Cenote", price: 120, category: "experience", iconName: "Palmtree" },
];

const iconMap: Record<string, React.ElementType> = {
  Car, UtensilsCrossed, Palmtree, Sparkles, Home,
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function HostHubPage({ params }: { params: Promise<{ hostId: string }> }) {
  const resolvedParams = use(params);
  const hostId = resolvedParams.hostId;
  const { lang, toggleLang, t } = useLanguage();

  // ── Real data from localStorage ──────────────────────────────────────────
  const [properties, setProperties] = useState<StoredProperty[]>(FALLBACK_PROPERTIES);
  const [experiences, setExperiences] = useState<StoredUpsell[]>(FALLBACK_UPSELLS);
  const [hubName, setHubName] = useState("My StayHost");
  const [checkin, setCheckin] = useState("");
  const [checkout, setCheckout] = useState("");
  const [guestCount, setGuestCount] = useState("2");

  useEffect(() => {
    try {
      // Properties
      const rawProps = localStorage.getItem("stayhost_properties");
      if (rawProps) {
        const parsed: StoredProperty[] = JSON.parse(rawProps);
        const active = parsed.filter(p => p.status !== "inactive");
        if (active.length > 0) setProperties(active);
      }
      // Upsells / Experiences (global ones)
      const rawUpsells = localStorage.getItem("stayhost_upsells");
      if (rawUpsells) {
        const parsed: StoredUpsell[] = JSON.parse(rawUpsells);
        const globalActive = parsed.filter(u => u.active !== false && u.isGlobal);
        if (globalActive.length > 0) setExperiences(globalActive);
      }
      // Hub name from hub config
      const rawConfig = localStorage.getItem("stayhost_hub_config");
      if (rawConfig) {
        const cfg = JSON.parse(rawConfig);
        if (cfg.name) setHubName(cfg.name);
      }
    } catch { /* ignore */ }
  }, []);

  const hostData = {
    name: hubName,
    logo: "https://images.unsplash.com/photo-1541462608143-67571c6738dd?w=150&h=150&fit=crop",
    heroImage: "https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?q=80&w=2070&auto=format&fit=crop",
  };

  return (
    <main className="min-h-screen bg-[#FDFBF7] text-slate-800 font-sans selection:bg-amber-200">

      {/* NAVEGACIÓN TRANSPARENTE */}
      <nav className="fixed top-0 inset-x-0 z-50 px-6 py-4 flex items-center justify-between backdrop-blur-md bg-white/60 border-b border-white/20 shadow-sm">
        <div className="flex items-center gap-3">
          <img src={hostData.logo} alt="Logo" className="w-10 h-10 rounded-full object-cover shadow-md border-2 border-white" />
          <span className="font-bold text-xl tracking-tight text-slate-900">{hostData.name}</span>
        </div>
        <div className="hidden md:flex gap-6 font-medium text-sm text-slate-600">
          <a href="#alojamientos" className="hover:text-amber-600 transition-colors">{t("accommodations")}</a>
          <a href="#experiencias" className="hover:text-amber-600 transition-colors">{t("experiences")}</a>
          <a href="#nosotros" className="hover:text-amber-600 transition-colors">{t("aboutUs")}</a>
        </div>
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={toggleLang} className="gap-2 font-bold hover:bg-white/50 rounded-full">
            <Globe className="w-4 h-4" />
            <span className="uppercase">{lang}</span>
          </Button>
          <Button className="gradient-gold text-white rounded-full px-6 font-semibold shadow-lg shadow-amber-500/20 hover:scale-105 transition-transform">
            {t("enter")}
          </Button>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative h-[85vh] w-full flex items-center justify-center">
        <div className="absolute inset-0 overflow-hidden">
          <img src={hostData.heroImage} alt="Hero" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/30 to-[#FDFBF7]" />
        </div>

        <div className="relative z-10 text-center px-4 max-w-4xl mt-12">
          <Badge className="bg-white/20 text-white hover:bg-white/30 backdrop-blur-md mb-6 border-white/40 shadow-xl px-4 py-1">
            {t("welcomeBadge")}
          </Badge>
          <h1 className="text-5xl md:text-7xl font-extrabold text-white mb-6 drop-shadow-lg tracking-tight">
            {t("heroTitle")}
          </h1>
          <p className="text-lg md:text-xl text-white/90 font-medium max-w-2xl mx-auto drop-shadow-md mb-12">
            {t("heroSub")}
          </p>

          {/* Search bar */}
          <div className="bg-white p-6 rounded-2xl shadow-xl w-full max-w-4xl mx-auto flex flex-col md:flex-row items-end gap-4 transform transition-all hover:shadow-2xl">
            <div className="w-full text-left">
              <label className="block text-sm font-bold text-slate-700 mb-1">{t("checkinLabel")}</label>
              <input
                type="date"
                value={checkin}
                onChange={e => setCheckin(e.target.value)}
                title="Fecha de check-in"
                aria-label="Fecha de check-in"
                className="w-full border border-slate-200 rounded-lg px-4 py-3 text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 bg-slate-50"
              />
            </div>
            <div className="w-full text-left">
              <label className="block text-sm font-bold text-slate-700 mb-1">{t("checkoutLabel")}</label>
              <input
                type="date"
                value={checkout}
                onChange={e => setCheckout(e.target.value)}
                title="Fecha de check-out"
                aria-label="Fecha de check-out"
                className="w-full border border-slate-200 rounded-lg px-4 py-3 text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 bg-slate-50"
              />
            </div>
            <div className="w-full text-left">
              <label className="block text-sm font-bold text-slate-700 mb-1">{t("guestsLabel")}</label>
              <select
                value={guestCount}
                onChange={e => setGuestCount(e.target.value)}
                title="Número de huéspedes"
                aria-label="Número de huéspedes"
                className="w-full border border-slate-200 rounded-lg px-4 py-3 text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 bg-slate-50"
              >
                {["1","2","3","4","5","6","7","8"].map(n => (
                  <option key={n} value={n}>{n} {t(n === "1" ? "g1" : "g2")}</option>
                ))}
              </select>
            </div>
            <Button className="w-full md:w-auto px-10 py-6 h-auto rounded-xl gradient-gold text-white font-bold text-lg hover:scale-105 transition-transform flex items-center justify-center gap-2 shadow-lg shadow-amber-500/30">
              <Search className="w-5 h-5" />
              <span>{t("btnSearch")}</span>
            </Button>
          </div>
        </div>
      </section>

      {/* SECCIÓN ALOJAMIENTOS */}
      <section id="alojamientos" className="py-20 px-6 max-w-7xl mx-auto">
        <div className="flex justify-between items-end mb-10">
          <div>
            <h2 className="text-3xl font-bold text-slate-900 mb-2">{t("ourStays")}</h2>
            <p className="text-slate-600 font-medium text-lg">{t("staysSub")}</p>
          </div>
          <Button variant="ghost" className="hidden sm:flex text-amber-600 hover:text-amber-700 font-semibold gap-1">
            {t("viewAll")} <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {properties.map((prop) => (
            <Link href={`/hub/${hostId}/${prop.id}`} key={prop.id} className="group cursor-pointer">
              <div className="relative aspect-[4/3] overflow-hidden rounded-2xl mb-4 shadow-sm group-hover:shadow-xl transition-all duration-300">
                <img
                  src={prop.image || "https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?w=800&q=80"}
                  alt={prop.name}
                  className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-500"
                />
                {prop.rating && (
                  <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-lg flex items-center gap-1 font-bold text-sm shadow-sm">
                    <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                    {prop.rating}
                  </div>
                )}
              </div>
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold text-lg text-slate-900 group-hover:text-amber-600 transition-colors">{prop.name}</h3>
                  <p className="text-slate-500 flex items-center gap-1 text-sm mt-1">
                    <MapPin className="w-3.5 h-3.5" />
                    {prop.city || prop.address || ""}
                  </p>
                </div>
                {prop.price && (
                  <div className="text-right">
                    <span className="font-extrabold text-lg text-slate-900 block">${prop.price}</span>
                    <span className="text-xs font-medium text-slate-500 uppercase tracking-widest block mt-0.5">{t("perNight")}</span>
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>

        {properties.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center text-muted-foreground">
              <Home className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="font-medium">Aún no hay propiedades publicadas.</p>
            </CardContent>
          </Card>
        )}
      </section>

      {/* SECCIÓN EXPERIENCIAS */}
      <section id="experiencias" className="py-24 bg-white border-y border-slate-100">
        <div className="max-w-7xl mx-auto px-6">
          <div className="mb-12 text-center max-w-2xl mx-auto">
            <Badge variant="outline" className="text-amber-600 border-amber-600/30 bg-amber-50 mb-4 px-4 py-1 text-sm">
              {t("exclusiveBadge")}
            </Badge>
            <h2 className="text-4xl font-bold text-slate-900 mb-4">{t("expTitle")}</h2>
            <p className="text-slate-600 text-lg">{t("expSub")}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {experiences.map((exp) => {
              const Icon = iconMap[exp.iconName || "Sparkles"] || Sparkles;
              return (
                <div key={exp.id} className="group relative overflow-hidden rounded-3xl bg-slate-50 border border-slate-100 hover:border-amber-200 hover:shadow-xl transition-all duration-300 cursor-pointer">
                  <div className="p-8 flex flex-col gap-4">
                    <div className="h-14 w-14 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center group-hover:bg-amber-100 transition-colors">
                      <Icon className="h-7 w-7 text-amber-600" />
                    </div>
                    <div>
                      <Badge variant="secondary" className="text-[10px] uppercase tracking-wider mb-2">{exp.category || "Experiencia"}</Badge>
                      <h3 className="font-bold text-xl text-slate-900 mb-1">{exp.name}</h3>
                      {exp.description && <p className="text-slate-500 text-sm leading-relaxed line-clamp-2">{exp.description}</p>}
                    </div>
                    <div className="flex items-center justify-between pt-4 border-t border-slate-200 mt-auto">
                      <div>
                        <span className="text-2xl font-extrabold text-slate-900">${exp.price}</span>
                        <span className="text-slate-500 text-sm ml-1">/ persona</span>
                      </div>
                      <Button size="sm" className="gradient-gold text-white rounded-xl font-semibold shadow-md border-none">
                        {lang === "es" ? "Agregar" : "Add"}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ABOUT / FOOTER SECTION */}
      <section id="nosotros" className="py-20 px-6 max-w-4xl mx-auto text-center">
        <img src={hostData.logo} alt={hostData.name} className="w-20 h-20 rounded-full mx-auto mb-6 border-4 border-amber-200 object-cover shadow-lg" />
        <h2 className="text-3xl font-bold text-slate-900 mb-4">{hostData.name}</h2>
        <p className="text-slate-600 text-lg leading-relaxed mb-8">
          {lang === "es"
            ? "Mejora tu estadía con nuestras actividades locales recomendadas y curadas por nosotros."
            : "Enhance your stay with our local activities recommended and curated by us."}
        </p>
        <Button className="gradient-gold text-white rounded-full px-10 py-6 h-auto font-bold text-lg shadow-xl border-none hover:scale-105 transition-transform">
          {lang === "es" ? "Reservar Ahora" : "Book Now"}
        </Button>
      </section>

    </main>
  );
}
