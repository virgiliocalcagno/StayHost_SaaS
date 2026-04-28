import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LoginForm } from "./LoginForm";

/**
 * Login page (server component).
 *
 * Validamos la sesion server-side antes de renderizar — si hay usuario,
 * redirect al destino antes de mandar HTML al browser. Asi cerramos el
 * agujero donde un check client-side podia ser bypasseado por estado
 * residual en el cliente.
 *
 * El form en si es un client component (LoginForm).
 */
export default async function AccesoPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; email?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect(params.next ?? "/dashboard");
  }

  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <p className="text-muted-foreground text-sm">Cargando...</p>
        </div>
      }
    >
      <LoginForm initialEmail={params.email ?? ""} />
    </Suspense>
  );
}
