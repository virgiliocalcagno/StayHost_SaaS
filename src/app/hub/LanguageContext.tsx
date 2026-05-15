"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';

type Language = 'es' | 'en';

type Dictionary = {
  [key: string]: {
    es: string;
    en: string;
  };
};

const dic: Dictionary = {
  // Global & Nav
  enter: { es: "Entrar", en: "Login" },
  accommodations: { es: "Alojamientos", en: "Stays" },
  experiences: { es: "Experiencias", en: "Experiences" },
  aboutUs: { es: "Nosotros", en: "About Us" },
  back: { es: "Volver a", en: "Back to" },
  share: { es: "Compartir", en: "Share" },
  save: { es: "Guardar", en: "Save" },

  // Hero Search
  welcomeBadge: { es: "✨ Bienvenido a tu próxima aventura", en: "✨ Welcome to your next adventure" },
  heroTitle: { es: "Descubre hogares únicos, vive experiencias completas", en: "Discover unique homes, live complete experiences" },
  heroSub: { es: "Reserva directo con nosotros. Sin comisiones extra, atención VIP garantizada.", en: "Book direct with us. No extra fees, VIP attention guaranteed." },
  checkinLabel: { es: "Llegada (Check-in)", en: "Check-in" },
  checkoutLabel: { es: "Salida (Check-out)", en: "Check-out" },
  guestsLabel: { es: "Huéspedes", en: "Guests" },
  btnSearch: { es: "Ver Disponibilidad", en: "Search Availability" },
  g1: { es: "1 Huésped", en: "1 Guest" },
  g2: { es: "2 Huéspedes", en: "2 Guests" },
  g3: { es: "3 Huéspedes", en: "3 Guests" },
  g4: { es: "4+ Huéspedes", en: "4+ Guests" },

  // Host Hub Listings
  ourStays: { es: "Nuestros Alojamientos", en: "Our Stays" },
  staysSub: { es: "Propiedades exclusivas preparadas con altos estándares.", en: "Exclusive properties prepared with high standards." },
  viewAll: { es: "Ver todas", en: "View all" },
  perNight: { es: "/ noche", en: "/ night" },
  exclusiveBadge: { es: "EXCLUSIVO", en: "EXCLUSIVE" },
  expTitle: { es: "Experiencias y Más", en: "Experiences & More" },
  expSub: { es: "Personalizamos tu viaje de inicio a fin. Agrégalas durante tu reserva directa o cómpralas ahora.", en: "We personalize your trip from start to finish. Add them during booking or buy now." },
  btnAdd: { es: "Añadir", en: "Add" },
  viewCatalog: { es: "Ver catálogo completo de experiencias", en: "View full experience catalog" },
  footerTag: { es: "Haciendo de cada estancia una experiencia inolvidable. Reserva directo y obtén el mejor trato.", en: "Making every stay unforgettable. Book direct and get the best deal." },

  // Property Page
  reviews: { es: "reseñas", en: "reviews" },
  showAllPhotos: { es: "Mostrar todas las fotos", en: "Show all photos" },
  guests: { es: "huéspedes", en: "guests" },
  beds: { es: "camas", en: "beds" },
  bedrooms: { es: "habitaciones", en: "bedrooms" },
  baths: { es: "baños", en: "baths" },
  superhost: { es: "SuperAnfitrión", en: "Superhost" },
  aboutSpace: { es: "Acerca de este espacio", en: "About this space" },
  readMore: { es: "Leer más", en: "Read more" },
  whatsIncluded: { es: "Qué incluye este lugar", en: "What this place offers" },
  showAllAmenities: { es: "Mostrar todas las amenidades", en: "Show all amenities" },
  powerYourExp: { es: "Potencia tu experiencia", en: "Power up your experience" },
  exclusiveServices: { es: "Servicios Exclusivos", en: "Exclusive Services" },
  exclusiveDesc: { es: "Añade estas experiencias directamente a tu reserva y nosotros nos encargamos de todo.", en: "Add these experiences directly to your booking and we'll take care of the rest." },
  directBooking: { es: "Reserva Directa", en: "Direct Booking" },
  bookNow: { es: "Reservar Ahora", en: "Book Now" },
  noChargeYet: { es: "Aún no se te cobrará ningún importe", en: "You won't be charged yet" },
  extraServices: { es: "Servicios Extra", en: "Extra Services" },
  cleaningFee: { es: "Tarifa de limpieza", en: "Cleaning fee" },
  taxes: { es: "Impuestos", en: "Taxes" },
  total: { es: "Total (USD)", en: "Total (USD)" },
  securePayment: { es: "Pago 100% Seguro", en: "100% Secure Payment" },
  securePaymentDesc: { es: "Tu reserva está protegida directamente por", en: "Your booking is protected directly by" },

  // Tienda Local (/hub/[hostId]/extras)
  shopBadge: { es: "🛍️ Tienda local", en: "🛍️ Local shop" },
  shopTitleSuffix: { es: "tienda local de", en: "local shop of" },
  shopSubGeneric: {
    es: "Excursiones, transporte, gastronomía y experiencias curadas para que vivas lo mejor del destino — sin importar dónde te hospedes.",
    en: "Excursions, transport, gastronomy and curated experiences so you can live the best of the destination — wherever you stay.",
  },
  shopStatActivities: { es: "experiencias curadas", en: "curated experiences" },
  shopStat247: { es: "Atención 24/7", en: "24/7 Support" },
  shopStatSecure: { es: "Pago 100% seguro", en: "100% secure payment" },
  shopBrowseCategories: { es: "Explorá por categoría", en: "Browse by category" },
  shopCategorySub: {
    es: "Cubrimos todo lo que necesitas para disfrutar tu viaje sin preocuparte por nada.",
    en: "We cover everything you need to enjoy your trip stress-free.",
  },
  shopHowItWorks: { es: "Cómo funciona", en: "How it works" },
  shopHowSub: { es: "Tres pasos. Cero fricciones.", en: "Three steps. Zero friction." },
  shopStep1Title: { es: "Elegí tu experiencia", en: "Pick your experience" },
  shopStep1Desc: {
    es: "Navegá el catálogo, mirá fotos y detalles, y agregá lo que te interese al carrito.",
    en: "Browse the catalog, check photos and details, and add what you want to your cart.",
  },
  shopStep2Title: { es: "Reservá y pagá seguro", en: "Book and pay securely" },
  shopStep2Desc: {
    es: "Pagá online con PayPal o coordiná por WhatsApp directo con el host. Vos elegís.",
    en: "Pay online with PayPal or coordinate via WhatsApp directly with the host. Your choice.",
  },
  shopStep3Title: { es: "Disfrutá del destino", en: "Enjoy the destination" },
  shopStep3Desc: {
    es: "Te contactamos para coordinar fecha, hora y detalles. Vos solo disfrutás.",
    en: "We reach out to coordinate date, time, and details. You just enjoy.",
  },
  shopWhyTitle: { es: "Por qué reservar acá", en: "Why book with us" },
  shopWhySub: { es: "Local, confiable, sin sorpresas.", en: "Local, trusted, no surprises." },
  shopWhy1Title: { es: "Curado por locales", en: "Curated by locals" },
  shopWhy1Desc: {
    es: "Conocemos cada proveedor personalmente. Solo vendemos lo que recomendamos.",
    en: "We know every vendor personally. We only sell what we'd recommend.",
  },
  shopWhy2Title: { es: "Atención directa", en: "Direct attention" },
  shopWhy2Desc: {
    es: "Hablás con el host real por WhatsApp, no con un call center.",
    en: "You talk to the real host via WhatsApp, not a call center.",
  },
  shopWhy3Title: { es: "Pago protegido", en: "Protected payment" },
  shopWhy3Desc: {
    es: "PayPal procesa el cobro. Si algo sale mal, tenés respaldo del 100% del monto.",
    en: "PayPal processes the payment. If anything goes wrong, you have 100% backing.",
  },
  shopContactTitle: { es: "¿Necesitás ayuda eligiendo?", en: "Need help choosing?" },
  shopContactSub: {
    es: "Te recomendamos lo mejor según tu plan. Sin compromiso.",
    en: "We'll recommend the best fit for your plan. No commitment.",
  },
  shopEmptyTitle: { es: "Catálogo en preparación", en: "Catalog in preparation" },
  shopEmptyDesc: {
    es: "Estamos curando los servicios más recomendables del destino. Volvé pronto o contactanos para una sugerencia personalizada.",
    en: "We're curating the most recommended services in the area. Come back soon or contact us for a personalized recommendation.",
  },
  shopFooterLookingStay: { es: "¿Buscás alojamiento?", en: "Looking for accommodation?" },
  shopFooterFullHub: { es: "Visitá nuestro hub completo", en: "Visit our full hub" },
  shopFooterPowered: { es: "Hecho con StayHost", en: "Made with StayHost" },
  contactUs: { es: "Contactanos", en: "Contact us" },

  // Categorías (alineadas con UPSELL_CATEGORY_LABELS pero con tono comercial)
  catExcursion: { es: "Excursiones", en: "Excursions" },
  catTransport: { es: "Transporte", en: "Transport" },
  catFood: { es: "Gastronomía", en: "Food & Dining" },
  catLaundry: { es: "Lavandería", en: "Laundry" },
  catSpa: { es: "Spa & Bienestar", en: "Spa & Wellness" },
  catConcierge: { es: "Concierge", en: "Concierge" },
  catRental: { es: "Alquileres", en: "Rentals" },
  catConnectivity: { es: "Conectividad", en: "Connectivity" },
  catService: { es: "Servicios", en: "Services" },
  catOther: { es: "Otros", en: "Other" },
};

interface LanguageContextProps {
  lang: Language;
  toggleLang: () => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextProps | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Language>('es');

  useEffect(() => {
    // Si quisieras detectar el idioma automático:
    const browserLang = navigator.language.startsWith('en') ? 'en' : 'es';
    // setLang(browserLang); 
    // Por motivos de la demostración lo dejamos que el usuario lo cambie manual
  }, []);

  const toggleLang = () => {
    setLang(prev => prev === 'es' ? 'en' : 'es');
  };

  const t = (key: string) => {
    if (!dic[key]) return key;
    return dic[key][lang];
  };

  return (
    <LanguageContext.Provider value={{ lang, toggleLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
