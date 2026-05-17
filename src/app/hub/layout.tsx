"use client";

import React from "react";
import { Toaster } from "sonner";
import { LanguageProvider } from "./LanguageContext";

export default function HubLayout({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <div className="hub-layout">
        {children}
        {/* Toaster del hub público — feedback al agregar al carrito,
            errores de checkout, login, etc. Esquina inferior derecha
            (no obstruye el floating cart button que vive en la misma
            zona, pero con z-index distinto). */}
        <Toaster richColors position="top-center" duration={2000} />
      </div>
    </LanguageProvider>
  );
}
