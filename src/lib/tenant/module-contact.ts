/**
 * Resolver de contacto operativo POR MÓDULO del SaaS.
 *
 * Estrategia de resolución (en orden):
 *   1) team_members.perm_module_X = true  → encargado preferido (caso común)
 *      Si hay varios, devolvemos el más reciente (created_at desc).
 *   2) tenant_module_contacts (compat de Sprint 8d)  → encargado externo
 *      que NO es team member (proveedor, agencia, etc.).
 *   3) tenants.contact_email / owner_whatsapp  → fallback al dueño.
 *   4) tenants.email (cuenta Auth)  → SOLO si includeAuthEmailFallback=true.
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

// Solo los módulos que existen como columnas en team_members. Los otros
// (reservations, support) caen directo al fallback de tenant_module_contacts
// + owner — no tienen flag dedicado en el panel de Equipo.
const TEAM_MEMBER_MODULE_COLUMNS: Partial<Record<TenantModule, string>> = {
  shop: "perm_module_shop",
  cleaning: "perm_module_cleaning",
  checkin: "perm_module_checkin",
  maintenance: "perm_module_maintenance",
};

/**
 * Devuelve el contacto operativo para mandar notifs de un módulo.
 *
 * Orden de preferencia (primer no-null gana):
 *   1) team_members con perm_module_X = true   → email + phone del staff
 *   2) tenant_module_contacts (compat 8d)      → encargado externo
 *   3) tenants.contact_email / owner_whatsapp  → fallback público al dueño
 *   4) tenants.email (cuenta Auth)             → SOLO si opts.includeAuthEmailFallback
 */
export async function getModuleContactForTenant(
  tenantId: string,
  module: TenantModule,
  opts: GetModuleContactOptions = {},
): Promise<ModuleContact | null> {
  const teamMemberColumn = TEAM_MEMBER_MODULE_COLUMNS[module];

  // Cargamos tenant + módulo en paralelo. El team_member solo si el módulo
  // tiene columna asociada (shop/cleaning/checkin/maintenance).
  const [{ data: tenant }, { data: moduleContact }, { data: teamMember }] = await Promise.all([
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
    teamMemberColumn
      ? supabaseAdmin
          .from("team_members")
          .select("name, email, phone")
          .eq("tenant_id", tenantId)
          .eq(teamMemberColumn, true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
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
  const tm = teamMember as {
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;

  // Email del team_member: filtrar pseudo-emails (`+phone+tenant@stayhost.local`).
  // Esos no son emails reales, son placeholder para que Supabase Auth acepte
  // logins por teléfono. Si el staff solo tiene pseudo-email, su "email
  // operativo" es nulo — caemos al siguiente fallback.
  const teamMemberEmail =
    tm?.email && !tm.email.endsWith("@stayhost.local") ? tm.email : null;
  const teamMemberPhone = tm?.phone ?? null;

  // Por defecto NO caemos a tenants.email — ese campo es PII del owner del
  // SaaS y exponerlo al huésped (vía endpoint público de hub) sería un leak.
  // Solo lo permitimos cuando el caller declara explícitamente que es uso
  // interno (cron, email al host, dashboard del owner).
  const ownerEmailFallback = opts.includeAuthEmailFallback
    ? t.contact_email || t.email
    : t.contact_email;

  return {
    tenantId: t.id,
    module,
    hostName: t.company || t.name || "Host",
    // Nombre del encargado: team member > contacto externo > null.
    contactName: tm?.name ?? mc?.name ?? null,
    // Email: team member > contacto externo > owner fallback.
    email: teamMemberEmail || mc?.email || ownerEmailFallback || null,
    // WhatsApp: team member > contacto externo > owner.
    whatsapp: teamMemberPhone || mc?.whatsapp || t.owner_whatsapp || null,
  };
}
