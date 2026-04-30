import Link from "next/link";

export const metadata = {
  title: "Política de Privacidad — StayHost",
  description: "Cómo StayHost recopila, usa y protege la información de hosts y huéspedes.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#FDFBF7] text-slate-800 py-16 px-6">
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="text-sm text-amber-600 hover:text-amber-700 font-medium mb-8 inline-block">
          ← Volver al inicio
        </Link>
        <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-2">Política de Privacidad</h1>
        <p className="text-sm text-slate-500 mb-10">Última actualización: 29 de abril de 2026</p>

        <div className="prose prose-slate max-w-none space-y-6 text-base leading-relaxed">
          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">1. Quiénes somos</h2>
            <p>
              StayHost es una plataforma SaaS para administradores de propiedades de alquiler temporario
              en Latinoamérica. Esta política describe cómo tratamos los datos personales de las personas
              que se registran en nuestra plataforma (&ldquo;hosts&rdquo;) y de los huéspedes que esos hosts
              gestionan a través de StayHost.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">2. Datos que recopilamos</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Datos del host:</strong> nombre, email, contraseña (cifrada), información de las propiedades que carga, integraciones que conecta (Airbnb, VRBO, TTLock, etc.).</li>
              <li><strong>Datos de huéspedes que el host carga:</strong> nombre, contacto, documento, fechas de estadía. Estos datos los carga el host bajo su propia responsabilidad legal frente al huésped.</li>
              <li><strong>Datos técnicos:</strong> dirección IP, navegador, eventos de uso de la plataforma para fines de seguridad y mejora del servicio.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">3. Para qué los usamos</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Operar la plataforma y prestar el servicio contratado.</li>
              <li>Sincronizar reservas con canales externos (iCal de Airbnb, VRBO).</li>
              <li>Generar accesos digitales (PINs TTLock) para huéspedes durante su estadía.</li>
              <li>Comunicarnos con el host sobre el servicio y actualizaciones relevantes.</li>
              <li>Cumplir con obligaciones legales (facturación, requerimientos de autoridades).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">4. Con quién los compartimos</h2>
            <p>
              No vendemos datos. Compartimos información estrictamente con proveedores que nos permiten
              prestar el servicio: Supabase (base de datos y autenticación), Vercel (hosting), TTLock
              (cerraduras inteligentes que el host elige conectar), proveedores de email transaccional.
              Cada uno tiene sus propias políticas de privacidad.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">5. Seguridad</h2>
            <p>
              Aplicamos cifrado en tránsito (HTTPS) y en reposo, separación lógica entre tenants
              (Row Level Security en Postgres), y revisamos accesos periódicamente. Ningún sistema es
              perfectamente seguro: te pedimos que uses contraseñas fuertes y no las compartas.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">6. Tus derechos</h2>
            <p>
              Podés solicitar acceso, rectificación o eliminación de tus datos personales escribiendo a
              <a href="mailto:virgiliocalcagno@gmail.com" className="text-amber-600 hover:text-amber-700"> virgiliocalcagno@gmail.com</a>.
              Si sos huésped y querés que un host elimine tu información, contactá directamente al host:
              StayHost almacena los datos por cuenta del host, que es el responsable de tratamiento.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">7. Retención</h2>
            <p>
              Los datos del host se conservan mientras la cuenta esté activa. Si cancelás tu cuenta,
              borramos tus datos en un plazo de 30 días, salvo que la ley nos exija conservarlos más tiempo.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">8. Cambios</h2>
            <p>
              Podemos actualizar esta política. Si los cambios son significativos, te avisamos por email
              al menos 15 días antes de su entrada en vigor.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-slate-900 mt-8 mb-3">9. Contacto</h2>
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
