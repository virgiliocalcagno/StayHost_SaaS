import type { Metadata, Viewport } from "next";

// Layout server-component del Vendor Portal permanente. Reusa el manifest
// PWA y theme color del portal viejo /v/[token] (mismo brand "StayHost
// Vendor"). Page es client-component, este layout cubre la metadata.

export const metadata: Metadata = {
  title: "StayHost — Mi Portal",
  description: "Tus órdenes, notificaciones y configuración.",
  manifest: "/manifest-vendor.webmanifest",
  applicationName: "StayHost Vendor",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "StayHost Vendor",
  },
  formatDetection: { telephone: false },
  icons: { icon: "/favicon.png", apple: "/favicon.png" },
};

export const viewport: Viewport = {
  themeColor: "#f59e0b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function VendorPortalPermLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
