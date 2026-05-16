import type { Metadata, Viewport } from "next";

// Server-component layout para el portal del vendor. Define el manifest
// PWA + metadata necesaria para que el browser ofrezca "Instalar app"
// y para que el theme-color combine con el header amber del portal.
//
// La page propiamente (`page.tsx`) es client-component y no puede
// exportar metadata; este layout lo cubre.

export const metadata: Metadata = {
  title: "StayHost — Portal del Proveedor",
  description: "Gestioná las órdenes que te llegan. Confirmar, declinar, marcar entregada.",
  manifest: "/manifest-vendor.webmanifest",
  applicationName: "StayHost Vendor",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "StayHost Vendor",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#f59e0b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function VendorPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
