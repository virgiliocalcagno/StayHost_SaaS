"use client";

// Hub "solo extras": variante del hub público sin sección de Alojamientos.
//
// Para qué sirve:
//   - El host comparte ESTE link con huéspedes que YA reservaron por Airbnb,
//     Booking, VRBO o directo. Esos huéspedes no necesitan ver las
//     propiedades — solo quieren contratar excursiones, transporte, comida.
//   - Tambien sirve para turistas locales que llegan al destino y quieren
//     servicios sin haber reservado nunca alojamiento con el host.
//
// Reutiliza:
//   - Mismo endpoint /api/public/hub/[hostId] (devuelve properties + experiences;
//     acá ignoramos properties)
//   - Mismo componente UpsellExperiences (catálogo + carrito + PayPal/WhatsApp)
//
// Diferencias vs /hub/[hostId]:
//   - Sin sección "Alojamientos" ni buscador de fechas
//   - Hero corto, foco en la oferta de servicios
//   - Empty state propio si el host no tiene experiencias cargadas
//     (en el hub completo eso es OK porque hay properties; acá la página
//     quedaría hueca).

import { use, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Globe, Home, ShoppingBag, Mail, MessageCircle } from "lucide-react";
import { useLanguage } from "../../LanguageContext";
import UpsellExperiences from "../UpsellExperiences";

type PricingModel = "fixed" | "per_person" | "per_unit" | "per_kg" | "per_night";

interface StoredUpsell {
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
  isGlobal: boolean;
  linkedPropertyIds: string[];
  vendor: { name: string; photo: string | null } | null;
}

export default function HubExtrasPage({ params }: { params: Promise<{ hostId: string }> }) {
  const resolvedParams = use(params);
  const hostId = resolvedParams.hostId;
  const { lang, toggleLang } = useLanguage();

  const [hubName, setHubName] = useState("Servicios");
  const [welcomeMessage, setWelcomeMessage] = useState<string | null>(null);
  const [hubLogo, setHubLogo] = useState<string | null>(null);
  const [contactEmail, setContactEmail] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);
  const [paypalEnabled, setPaypalEnabled] = useState(false);
  const [experiences, setExperiences] = useState<StoredUpsell[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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

  const whatsappLink = whatsapp ? `https://wa.me/${whatsapp.replace(/\D/g, "")}` : null;
  const logoSrc =
    hubLogo ||
    "https://images.unsplash.com/photo-1541462608143-67571c6738dd?w=150&h=150&fit=crop";

  if (notFound) {
    return (
      <main className="min-h-screen bg-[#FDFBF7] flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <Home className="h-16 w-16 mx-auto mb-4 text-slate-300" />
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Hub no encontrado</h1>
          <p className="text-slate-600">
            El enlace que abriste no corresponde a un host activo. Verificá la URL con quien te la compartió.
          </p>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#FDFBF7] flex items-center justify-center">
        <div className="text-slate-500 font-medium">Cargando...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#FDFBF7] text-slate-800 font-sans selection:bg-amber-200">
      {/* NAV */}
      <nav className="sticky top-0 inset-x-0 z-50 px-6 py-4 flex items-center justify-between backdrop-blur-md bg-white/70 border-b border-white/40 shadow-sm">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoSrc}
            alt={hubName}
            className="w-10 h-10 rounded-full object-cover shadow-md border-2 border-white"
          />
          <span className="font-bold text-xl tracking-tight text-slate-900">{hubName}</span>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={toggleLang} className="gap-2 font-bold hover:bg-white/50 rounded-full">
            <Globe className="w-4 h-4" />
            <span className="uppercase">{lang}</span>
          </Button>
        </div>
      </nav>

      {/* HERO compacto — sin buscador de fechas, sin imagen de fondo grande */}
      <section className="px-6 pt-16 pb-12 text-center max-w-3xl mx-auto">
        <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 mb-4 border-amber-200/60 px-4 py-1 text-sm">
          <ShoppingBag className="w-3.5 h-3.5 mr-1.5" />
          {lang === "es" ? "Tienda local" : "Local shop"}
        </Badge>
        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 tracking-tight mb-4">
          {lang === "es" ? `La tienda local de ${hubName}` : `${hubName}'s local shop`}
        </h1>
        <p className="text-lg text-slate-600 leading-relaxed">
          {lang === "es"
            ? "Excursiones, transporte, chef privado y más — curados para que vivas lo mejor del destino."
            : "Excursions, transport, private chef and more — curated so you can live the best of the destination."}
        </p>
        {welcomeMessage && (
          <p className="mt-8 text-base text-slate-700 italic max-w-2xl mx-auto leading-relaxed">
            &ldquo;{welcomeMessage}&rdquo;
          </p>
        )}
      </section>

      {/* EXPERIENCIAS — el corazón de esta página */}
      {experiences.length === 0 ? (
        <section className="px-6 py-20 text-center max-w-md mx-auto">
          <ShoppingBag className="h-12 w-12 mx-auto mb-4 text-slate-300" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">
            {lang === "es" ? "Catálogo en preparación" : "Catalog in preparation"}
          </h2>
          <p className="text-slate-600">
            {lang === "es"
              ? "Estamos armando la selección de servicios. Volvé pronto."
              : "We're curating the service selection. Check back soon."}
          </p>
          {whatsappLink && (
            <Button asChild className="mt-6 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full">
              <a href={whatsappLink} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="w-4 h-4" />
                {lang === "es" ? "Contactanos" : "Contact us"}
              </a>
            </Button>
          )}
        </section>
      ) : (
        <UpsellExperiences
          hostId={hostId}
          hostName={hubName}
          hostWhatsapp={whatsapp}
          experiences={experiences}
          lang={lang}
          paypalEnabled={paypalEnabled}
        />
      )}

      {/* CONTACTO / FOOTER */}
      <section className="py-16 px-6 max-w-3xl mx-auto text-center border-t border-slate-100 mt-12">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoSrc}
          alt={hubName}
          className="w-16 h-16 rounded-full mx-auto mb-4 border-4 border-amber-100 object-cover shadow"
        />
        <h2 className="text-2xl font-bold text-slate-900 mb-2">{hubName}</h2>
        <p className="text-slate-600 mb-6">
          {lang === "es"
            ? "¿Necesitás ayuda o una recomendación personalizada?"
            : "Need help or a personalized recommendation?"}
        </p>
        {(contactEmail || whatsappLink) && (
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-8">
            {whatsappLink && (
              <Button
                asChild
                className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full px-6 py-5 h-auto shadow-md"
              >
                <a href={whatsappLink} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="w-4 h-4" />
                  WhatsApp
                </a>
              </Button>
            )}
            {contactEmail && (
              <Button asChild variant="outline" className="gap-2 rounded-full px-6 py-5 h-auto">
                <a href={`mailto:${contactEmail}`}>
                  <Mail className="w-4 h-4" />
                  {contactEmail}
                </a>
              </Button>
            )}
          </div>
        )}
        <p className="text-[11px] text-slate-400 mt-4">
          {lang === "es" ? "¿Buscás alojamiento? Visitá nuestro " : "Looking for accommodation? Visit our "}
          <a href={`/hub/${encodeURIComponent(hostId)}`} className="underline hover:text-amber-600">
            {lang === "es" ? "hub completo" : "full hub"}
          </a>
          .
        </p>
      </section>
    </main>
  );
}
