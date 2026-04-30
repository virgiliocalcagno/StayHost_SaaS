import { supabase } from "@/lib/supabase/client";

/**
 * Cierra la sesion (server + cliente + storage local) y manda al usuario
 * a /acceso.
 *
 * El orden importa:
 *   1. POST /api/auth/signout — borra cookies sb-* via Set-Cookie. Esta
 *      es la unica forma confiable de eliminar las cookies de @supabase/ssr,
 *      el signOut puro del cliente no siempre lo logra.
 *   2. supabase.auth.signOut() — limpia listeners y estado en memoria.
 *   3. localStorage purge — por si quedaron tokens de un Supabase legacy.
 *   4. window.location.assign — full page load para que el middleware
 *      corra con la cookie nueva (vacia). Sin esto una soft navigation
 *      podria servir RSC cacheado.
 */
export async function logoutAndRedirect(target: string = "/acceso") {
  try {
    await fetch("/api/auth/signout", { method: "POST", credentials: "include" });
  } catch (err) {
    console.error("[logout] server signout failed:", err);
  }
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.error("[logout] client signOut failed:", err);
  }
  try {
    if (typeof window !== "undefined") {
      const keys = Object.keys(window.localStorage);
      for (const k of keys) {
        if (k.startsWith("sb-") || k.startsWith("supabase.")) {
          window.localStorage.removeItem(k);
        }
      }
    }
  } catch {}
  window.location.assign(target);
}
