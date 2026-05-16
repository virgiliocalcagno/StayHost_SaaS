"use client";

// Hook para capturar el evento beforeinstallprompt del browser y exponer
// un trigger para mostrar el prompt de instalación PWA.
//
// Cómo funciona:
//   1) Browser dispara 'beforeinstallprompt' cuando detecta que la PWA es
//      instalable (manifest válido + service worker + no instalada).
//   2) Lo guardamos en state.
//   3) Cuando el usuario clickea "Instalar", llamamos prompt.prompt().
//   4) Después de instalar, el evento ya no está disponible.
//
// iOS Safari NO dispara beforeinstallprompt — ahí hay que mostrar
// instrucciones manuales ("Compartir → Añadir a pantalla de inicio").

import { useEffect, useState, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Platform = "android" | "ios" | "desktop" | "other";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Mac|Windows|Linux/i.test(ua)) return "desktop";
  return "other";
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari
  if ("standalone" in navigator && (navigator as Navigator & { standalone?: boolean }).standalone) {
    return true;
  }
  // Resto
  return window.matchMedia?.("(display-mode: standalone)").matches ?? false;
}

export function usePwaInstall() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<Platform>("other");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setPlatform(detectPlatform());
    setInstalled(detectStandalone());
    // Persistimos en localStorage si el usuario clickea "ahora no" para no
    // molestar todo el tiempo. Reset al cabo de 7 días.
    try {
      const lastDismissed = localStorage.getItem("stayhost.vendor.install_dismissed_at");
      if (lastDismissed) {
        const days = (Date.now() - Number(lastDismissed)) / 86400000;
        if (days < 7) setDismissed(true);
      }
    } catch {
      /* private mode storage off — ignorar */
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    const installedHandler = () => setInstalled(true);
    window.addEventListener("appinstalled", installedHandler);

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!installEvent) return { outcome: "unavailable" as const };
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === "dismissed") {
      try {
        localStorage.setItem(
          "stayhost.vendor.install_dismissed_at",
          String(Date.now()),
        );
      } catch {
        /* ignore */
      }
      setDismissed(true);
    }
    if (choice.outcome === "accepted") setInstalled(true);
    setInstallEvent(null);
    return choice;
  }, [installEvent]);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(
        "stayhost.vendor.install_dismissed_at",
        String(Date.now()),
      );
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }, []);

  // Estado a renderizar:
  //   'installed'   → la PWA ya está instalada y abierta como standalone
  //   'native'      → Android/desktop con beforeinstallprompt → botón directo
  //   'ios-manual'  → iOS Safari → mostrar instrucciones manuales
  //   'dismissed'   → usuario dijo "no, gracias" hace menos de 7 días
  //   'unavailable' → browser sin soporte / no cumple criterio Web App Install
  let state: "installed" | "native" | "ios-manual" | "dismissed" | "unavailable";
  if (installed) state = "installed";
  else if (dismissed) state = "dismissed";
  else if (installEvent) state = "native";
  else if (platform === "ios") state = "ios-manual";
  else state = "unavailable";

  return { state, promptInstall, dismiss };
}
