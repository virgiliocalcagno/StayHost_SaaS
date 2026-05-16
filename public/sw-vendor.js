// StayHost — Service Worker para Web Push del vendor portal.
//
// Se registra desde /v/[token]/page.tsx la primera vez que el vendor
// concede permiso de notificaciones. Recibe push events del server y
// muestra notification + maneja clicks.
//
// Versionar el SW con un comentario al final fuerza re-instalación al
// updatear. Cambiá la fecha si modificás este archivo.
// SW_VERSION: 2026-05-27

self.addEventListener("install", () => {
  // Activar inmediato — sin esto el SW espera al próximo refresh.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Tomar control de todas las tabs abiertas del scope sin necesidad de F5.
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

  const title = payload.title || "Nueva orden";
  const options = {
    body: payload.body || "Tenés una orden esperando tu confirmación.",
    // Logo del SaaS — favicon de stayhost.
    icon: "/favicon.png",
    badge: "/favicon.png",
    // tag de-duplica notificaciones: si llega otra del mismo tag,
    // reemplaza la anterior en lugar de apilarse. Útil cuando re-enviamos
    // la misma orden por algún retry.
    tag: payload.tag || "stayhost-vendor",
    // requireInteraction: true → la notification no se cierra sola,
    // espera click. Importante para vendors que se enteran por la
    // notificación incluso cuando dejan el celular un rato.
    requireInteraction: true,
    data: {
      url: payload.url || "/",
    },
    actions: [
      { action: "open", title: "Ver orden" },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  // Si ya hay una tab abierta con el portal, enfocala. Sino abrí una nueva.
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const c of clients) {
          if (c.url.includes("/v/") && "focus" in c) {
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
