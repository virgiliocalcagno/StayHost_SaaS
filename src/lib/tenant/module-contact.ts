/**
 * Resolver de contacto operativo POR MÓDULO del SaaS.
 *
 * Reemplaza al anterior shop-contact.ts. Generalizado a 6 módulos para
 * escalar a futuro: shop, cleaning, checkin, maintenance, reservations,
 * support.
 *
 * Modelo BD: tabla tenant_module_contacts con (tenant_id, module) unique.
 *
 * Estrategia de resolución:
 *   1) Lookup en tenant_module_contacts (tenant_id, module)
 *   2) Si tiene email/whatsapp → usar eso
 *   3) Fallback al owner del tenant (contact_email, email, owner_whatsapp)
 *
 * Caso de uso típico:
 *   const c = await getModuleContactForTenant(tenantId, 'shop');
 *   sendEmail({ to: c.email, ... });
 */
import { supabaseAdmin } from "@/lib/supabase/admin";

export type TenantModule =
  | "shop"
  | "cleaning"
  | "checkin"
  | "maintenance"
  | "reservations"
  | "support";

export const MODULE_LABELS: Record<TenantModule, { icon: string; label: string; hint: string }> = {
  shop: {
    icon: "🛍️",
    label: "Tienda / Ventas Extras",
    hint: "Atiende vendor declines, cancelaciones, recordatorios de servicio, pagos PayPal.",
  },
  cleaning: {
    icon: "🧹",
    label: "Limpieza",
    hint: "Atiende limpiadoras, validación de fotos, pagos al cleaner, reportes.",
  },
  checkin: {
    icon: "🔑",
    label: "Check-in",
    hint: "Atiende llegadas, OCR de documentos, problemas con keybox, dudas del huésped.",
  },
  maintenance: {
    icon: "🔧",
    label: "Mantenimiento",
    hint: "Atiende tickets de propiedades, plomero, electricista, internet.",
  },
  reservations: {
    icon: "📅",
    label: "Reservas",
    hint: "Atiende bookings directos, dudas de fechas, disponibilidad.",
  },
  support: {
    icon: "💬",
    label: "Soporte general",
    hint: "Para todo lo que no encaje en los otros — fallback.",
  },
};

export type ModuleContact = {
  tenantId: string;
  module: TenantModule;
  hostName: string;
  contactName: string | null;
  email: string | null;
  whatsapp: string | null;
};

export type GetModuleContactOptions = {
  /**
   * Si true, el helper puede caer a `tenants.email` (la cuenta Supabase Auth
   * del owner) como último fallback de email.
   *
   * **NUNCA pasar `true` en endpoints públicos** — exponer la cuenta Auth al
   * huésped es leak de PII del operador del SaaS. Solo activá esto en
   * contextos internos (crons, envío de email al host, dashboard del owner).
   * Default: `false`.
   */
  includeAuthEmailFallback?: boolean;
};

/**
 * Devuelve el contacto operativo para mandar notifs de un módulo.
 *
 * Orden de preferencia para email:
 *   tenant_module_contacts.email (module)  → preferido
 *   tenants.contact_email                  → fallback público OK
 *   tenants.email (cuenta Auth)            → SOLO si includeAuthEmailFallback=true
 *
 * Para whatsapp:
 *   tenant_module_contacts.whatsapp        → preferido
 *   tenants.owner_whatsapp                 → fallback (campo público, OK siempre)
 */
export async function getModuleContactForTenant(
  tenantId: string,
  module: TenantModule,
  opts: GetModuleContactOptions = {},
): Promise<ModuleContact | null> {
  // Cargamos tenant + contacto del módulo en paralelo.
  const [{ data: tenant }, { data: moduleContact }] = await Promise.all([
    supabaseAdmin
      .from("tenants")
      .select("id, name, company, email, contact_email, owner_whatsapp")
      .eq("id", tenantId)
      .maybeSingle(),
    supabaseAdmin
      .from("tenant_module_contacts")
      .select("name, email, whatsapp")
      .eq("tenant_id", tenantId)
      .eq("module", module)
      .maybeSingle(),
  ]);

  if (!tenant) return null;
  const t = tenant as {
    id: string;
    name: string | null;
    company: string | null;
    email: string;
    contact_email: string | null;
    owner_whatsapp: string | null;
  };
  const mc = moduleContact as {
    name: string | null;
    email: string | null;
    whatsapp: string | null;
  } | null;

  // Por defecto NO caemos a tenants.email — ese campo es PII del owner del
  // SaaS y exponerlo al huésped (vía endpoint público de hub) sería un leak.
  // Solo lo permitimos cuando el caller declara explícitamente que es uso
  // interno (cron, email al host, dashboard del owner).
  const emailFallback = opts.includeAuthEmailFallback
    ? t.contact_email || t.email
    : t.contact_email;

  return {
    tenantId: t.id,
    module,
    hostName: t.company || t.name || "Host",
    contactName: mc?.name ?? null,
    email: mc?.email || emailFallback || null,
    whatsapp: mc?.whatsapp || t.owner_whatsapp || null,
  };
}
