import Link from "next/link";

export const metadata = {
  title: "Términos y Condiciones — StayHost",
  description: "Términos del servicio StayHost para hosts y administradores de propiedades.",
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#FDFBF7] text-slate-800 py-16 px-6">
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="text-sm text-amber-600 hover:text-amber-700 font-medium mb-8 inline-block">
          ← Volver al inicio
        </Link>
        <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-2">Términos y Condiciones</h1>
        <p className="text-sm text-slate-500 mb-10">Última actualización: 29 de abril de 2026</p>

        <div className="prose prose-slate max-w-none space-y-6 text-base leading-relaxed">
          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">1. Aceptación</h2>
            <p>
              Al registrarte y usar StayHost aceptás estos términos. Si no estás de acuerdo,
              no uses el servicio.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">2. Descripción del servicio</h2>
            <p>
              StayHost es una plataforma SaaS que permite a administradores de propiedades de alquiler
              temporario centralizar reservas, accesos digitales, limpieza, comunicación con huéspedes
              y otros aspectos operativos. El servicio incluye integraciones con canales externos
              (Airbnb, VRBO) y dispositivos de terceros (TTLock) que vos elegís conectar.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">3. Cuenta y prueba gratuita</h2>
            <p>
              Te ofrecemos 14 días de prueba gratuita al registrarte. Vencido el período, podés contratar
              uno de nuestros planes (Starter, Growth, Master) o un plan a medida. Sin pago activo,
              tu cuenta queda restringida al final del trial.
            </p>
            <p>
              Sos responsable de mantener la seguridad de tu cuenta y de toda la actividad que ocurra
              bajo ella. Notificanos de inmediato cualquier acceso no autorizado.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">4. Uso aceptable</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>No usar StayHost para actividades ilegales ni para hostear contenido que viole derechos de terceros.</li>
              <li>No intentar acceder a datos de otros tenants ni comprometer la seguridad de la plataforma.</li>
              <li>No usar la plataforma para spam ni para enviar comunicaciones no solicitadas a huéspedes ajenos.</li>
              <li>Cumplir con las leyes locales aplicables a tu actividad (alquiler temporario, registro de huéspedes, impuestos).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">5. Datos de huéspedes</h2>
            <p>
              Vos sos el responsable de tratamiento (data controller) de los datos personales de tus
              huéspedes que cargás en StayHost. StayHost actúa como encargado de tratamiento (data
              processor) bajo tus instrucciones. Te recomendamos cumplir con las regulaciones
              aplicables (LATAM, GDPR si aplica) en tu jurisdicción.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">6. Pagos y facturación</h2>
            <p>
              Durante el período beta, los planes pagos se facturan manualmente fuera de la plataforma.
              Al ofrecer cobro automático integrado, te avisaremos con anticipación. Los cargos no son
              reembolsables salvo que lo establezca la ley.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">7. Disponibilidad</h2>
            <p>
              Hacemos esfuerzos razonables para mantener StayHost disponible 24/7, pero no garantizamos
              disponibilidad ininterrumpida. Podemos realizar tareas de mantenimiento programado con
              previo aviso. No somos responsables por caídas de servicios de terceros (Airbnb, TTLock,
              email, etc.).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">8. Limitación de responsabilidad</h2>
            <p>
              StayHost se provee &ldquo;tal cual&rdquo;. No somos responsables por pérdidas indirectas,
              lucro cesante, ni daños emergentes. Nuestra responsabilidad máxima frente a vos no
              excederá el importe pagado por el servicio en los 3 meses previos al evento que motiva
              el reclamo.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">9. Cancelación</h2>
            <p>
              Podés cancelar tu cuenta en cualquier momento desde la configuración o escribiéndonos.
              Podemos suspender o cerrar cuentas que violen estos términos, con notificación previa
              cuando sea posible.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">10. Cambios</h2>
            <p>
              Podemos actualizar estos términos. Te avisamos los cambios significativos con al menos
              15 días de antelación. Si seguís usando el servicio después de la entrada en vigor,
              aceptás los nuevos términos.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">11. Ley aplicable</h2>
            <p>
              Estos términos se rigen por las leyes de la jurisdicción donde StayHost tenga su sede
              operativa. Cualquier disputa se resolverá ante los tribunales competentes de esa jurisdicción.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">12. Contacto</h2>
            <p>
              Cualquier consulta:
              <a href="mailto:virgiliocalcagno@gmail.com" className="text-amber-600 hover:text-amber-700"> virgiliocalcagno@gmail.com</a>.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
