import { supabase } from "@/lib/supabase/client";

/**
 * Cierra la sesion de Supabase y manda al usuario a /acceso.
 *
 * Usa `window.location.assign` (full page load) en lugar de `router.replace`
 * para garantizar que el middleware corra con la cookie ya borrada. Sin
 * esto, una navegacion soft puede servir RSC cacheado y dejar al usuario
 * "logueado" hasta que refresque manual.
 */
export async function logoutAndRedirect(target: string = "/acceso") {
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.error("[logout] signOut failed:", err);
  }
  window.location.assign(target);
}
