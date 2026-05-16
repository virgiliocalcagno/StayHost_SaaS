"use client";

// Hook para el host suscribir/des-suscribir a Web Push notifications.
// Patrón paralelo al hook del vendor pero con auth de sesión real
// (no capability token) y SW propio en /sw-host.js.
//
// Flow:
//   1) usePwaInstall ya manejó instalación de la PWA si aplica.
//   2) usePushSubscription registra /sw-host.js + chequea permiso actual.
//   3) Si el browser soporta + no rechazó previo, expone enable() que
//      pide permission y POST a /api/host/push-subscribe.

import { useEffect, useState, useCallback } from "react";

export type PushStatus =
  | "checking"
  | "unsupported"
  | "denied"
  | "available"
  | "subscribed"
  | "subscribing"
  | "error";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const padded = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function useHostPush() {
  const [status, setStatus] = useState<PushStatus>("checking");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === "undefined") return;
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setStatus("denied");
        return;
      }
      try {
        // SW propio del host — separado del SW del vendor por scope.
        const reg = await navigator.serviceWorker.register("/sw-host.js", { scope: "/dashboard" });
        const existing = await reg.pushManager.getSubscription();
        if (!cancelled) setStatus(existing ? "subscribed" : "available");
      } catch (e) {
        console.error("[host push] SW register failed:", e);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidKey) {
      setStatus("error");
      setMessage("Push no configurado en el servidor.");
      return;
    }
    setStatus("subscribing");
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "available");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      });
      const r = await fetch("/api/host/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setStatus("subscribed");
      setMessage("¡Listo! Recibirás alerts al instante.");
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "No se pudo activar");
    }
  }, []);

  return { status, message, enable };
}
