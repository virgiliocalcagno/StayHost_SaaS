"use client";

import React from "react";
import { LanguageProvider } from "./LanguageContext";

export default function HubLayout({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <div className="hub-layout">
        {children}
      </div>
    </LanguageProvider>
  );
}
