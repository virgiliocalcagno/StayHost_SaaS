// StayHost — Service Worker para Web Push del HOST (dashboard).
//
// Separado del SW del vendor por scope (/dashboard vs /v/). Recibe push
// events del server cuando hay alerts críticos: vendor decline,
// recordatorios, etc.
//
// SW_VERSION: 2026-05-29

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "StayHost", body: event.data.text() };
  }

  const title = payload.title || "Alerta StayHost";
  const options = {
    body: payload.body || "Tenés una notificación nueva.",
    icon: "/favicon.png",
    badge: "/favicon.png",
    tag: payload.tag || "stayhost-host",
    requireInteraction: true,
    data: {
      url: payload.url || "/dashboard",
    },
    actions: [{ action: "open", title: "Abrir" }],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const c of clients) {
          if (c.url.includes("/dashboard") && "focus" in c) {
            c.navigate(url);
            return c.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(url);
        }
      }),
  );
});
