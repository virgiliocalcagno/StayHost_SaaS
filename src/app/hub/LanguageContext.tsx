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
  securePaymentDesc: { es: "Tu reserva está protegida directamente por", en: "Your booking is protected directly by" }
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
