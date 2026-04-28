import { supabase } from "@/lib/supabase/client";

/**
 * Cierra la sesion (server + cliente) y manda al usuario a /acceso.
 *
 * Llamamos al endpoint server-side `/api/auth/signout` para que las cookies
 * de Supabase se borren via `Set-Cookie` en la respuesta — el signOut puro
 * del cliente no siempre logra eliminarlas en preview/prod, y eso provoca
 * que el siguiente request a /acceso encuentre sesion viva y haga bypass
 * del login.
 *
 * El signOut del cliente queda como fallback para limpiar el estado en
 * memoria (subscriptions, listeners). Despues forzamos full page load con
 * `window.location.assign` para que el middleware corra con la cookie ya
 * borrada — sin esto, una soft navigation puede servir RSC cacheado.
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
  window.location.assign(target);
}
