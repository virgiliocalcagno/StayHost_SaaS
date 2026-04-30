"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Crown, MessageCircle, LogOut } from "lucide-react";

type Me = {
  email: string | null;
  trialExpired: boolean;
  isMaster: boolean;
  planExpiresAt: string | null;
};

// WhatsApp del owner del SaaS — desde env. Sin él, mostramos solo email
// como fallback. Setear NEXT_PUBLIC_OWNER_WHATSAPP en Vercel con el
// numero completo en formato internacional sin + (ej: 5491111111111).
const WHATSAPP_OWNER = (process.env.NEXT_PUBLIC_OWNER_WHATSAPP ?? "").replace(/\D/g, "");

export default function PricingWallPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  // Si llegan acá pero no están expirados (ej. recién renovaron), los
  // mandamos al dashboard. Si no hay sesión, a /acceso.
  useEffect(() => {
    fetch("/api/me", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Me | null) => {
        if (!data || !data.email) {
          router.replace("/acceso");
          return;
        }
        if (!data.trialExpired) {
          router.replace("/dashboard");
          return;
        }
        setMe(data);
      })
      .catch(() => router.replace("/acceso"));
  }, [router]);

  if (!me) {
    return (
      <main className="min-h-screen bg-[#FDFBF7] flex items-center justify-center">
        <div className="text-slate-500 font-medium">Cargando...</div>
      </main>
    );
  }

  const whatsappMsg = encodeURIComponent(
    `Hola Virgilio, mi trial de StayHost (${me.email}) venció. Quiero seguir usando el sistema. ¿Cómo seguimos?`
  );
  const whatsappUrl = `https://wa.me/${WHATSAPP_OWNER}?text=${whatsappMsg}`;

  return (
    <main className="min-h-screen bg-[#FDFBF7] flex items-center justify-center px-6 py-12">
      <div className="max-w-xl w-full text-center space-y-8">
        <div className="w-20 h-20 rounded-full gradient-gold flex items-center justify-center mx-auto shadow-xl">
          <Crown className="h-10 w-10 text-white" />
        </div>

        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-3">
            Tu prueba gratuita terminó
          </h1>
          <p className="text-slate-600 leading-relaxed">
            Gracias por probar StayHost durante 14 días. Para seguir usando el sistema y mantener
            tus propiedades, reservas y huéspedes operando, contactá a Virgilio para activar tu plan.
          </p>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-lg p-6 text-left space-y-4">
          <div className="font-semibold text-slate-900">Tus opciones</div>
          <ul className="space-y-3 text-sm text-slate-700">
            <li className="flex gap-2">
              <span className="text-amber-600 font-bold">·</span>
              <span><strong>Plan Starter ($29/mes)</strong> — propiedades, calendario, reservas, accesos básicos.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-amber-600 font-bold">·</span>
              <span><strong>Plan Growth ($79/mes)</strong> — incluye limpieza, equipo, dynamic pricing, upsells.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-amber-600 font-bold">·</span>
              <span><strong>Plan Master ($179/mes)</strong> — todos los módulos, prioridad de soporte.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-amber-600 font-bold">·</span>
              <span><strong>Plan a medida</strong> — para casos con necesidades específicas, hablamos.</span>
            </li>
          </ul>
        </div>

        <div className="space-y-3">
          {WHATSAPP_OWNER && (
            <Button asChild className="w-full gradient-gold text-white font-bold text-base py-6 rounded-xl shadow-lg gap-2">
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="h-5 w-5" />
                Contactar por WhatsApp
              </a>
            </Button>
          )}

          <div className="flex gap-3">
            <Button asChild variant="outline" className={`gap-2 ${WHATSAPP_OWNER ? "flex-1" : "w-full"}`}>
              <a href={`mailto:virgiliocalcagno@gmail.com?subject=Activar plan StayHost - ${me.email}`}>
                Escribir por email
              </a>
            </Button>
            <Button asChild variant="ghost" className="gap-2 text-slate-500">
              <Link href="/salir">
                <LogOut className="h-4 w-4" />
                Cerrar sesión
              </Link>
            </Button>
          </div>
        </div>

        <p className="text-xs text-slate-400">
          Tus datos están guardados intactos. Al activar el plan recuperás acceso inmediato sin perder nada.
        </p>
      </div>
    </main>
  );
}
