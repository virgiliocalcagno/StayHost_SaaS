/**
 * Resolver del contacto operativo de la TIENDA de un tenant.
 *
 * Para el módulo Ventas Extras (catálogo + Tienda Local + portal del
 * vendor + recordatorios), las notificaciones deben caer en la persona
 * que ATIENDE la tienda, no en el dueño del SaaS. El host configura
 * shop_contact_* en su panel; si NO lo configura, fallback al owner.
 *
 * Uso:
 *   const c = await getShopContactForTenant(tenantId);
 *   sendEmail({ to: c.email, ... });
 *   const waLink = c.whatsapp ? `https://wa.me/${c.whatsapp.replace(/\D/g,'')}` : null;
 *
 * Si ni shop_* ni owner están seteados, devuelve email/whatsapp = null.
 * El caller decide si skipea o usa otro fallback.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";

export type ShopContact = {
  tenantId: string;
  /** Nombre de la marca/empresa para subjects, headers, etc. */
  hostName: string;
  /** Nombre de la persona contacto (puede coincidir con hostName si no hay encargado separado). */
  contactName: string | null;
  /** Email donde caen las notifs operativas del módulo. NULL si nada configurado. */
  email: string | null;
  /** WhatsApp en E.164 ('+1...') para wa.me links. NULL si no configurado. */
  whatsapp: string | null;
};

/**
 * Devuelve el contacto resuelto para mandar notifs de la tienda.
 *
 * Orden de preferencia:
 *   email     → shop_contact_email, sino contact_email, sino email
 *   whatsapp  → shop_contact_whatsapp, sino owner_whatsapp
 *   contactName → shop_contact_name, sino null
 */
export async function getShopContactForTenant(
  tenantId: string,
): Promise<ShopContact | null> {
  const { data } = await supabaseAdmin
    .from("tenants")
    .select(
      "id, name, company, email, contact_email, owner_whatsapp, shop_contact_name, shop_contact_email, shop_contact_whatsapp",
    )
    .eq("id", tenantId)
    .maybeSingle();

  if (!data) return null;
  const t = data as {
    id: string;
    name: string | null;
    company: string | null;
    email: string;
    contact_email: string | null;
    owner_whatsapp: string | null;
    shop_contact_name: string | null;
    shop_contact_email: string | null;
    shop_contact_whatsapp: string | null;
  };

  return {
    tenantId: t.id,
    hostName: t.company || t.name || "Host",
    contactName: t.shop_contact_name,
    email: t.shop_contact_email || t.contact_email || t.email || null,
    whatsapp: t.shop_contact_whatsapp || t.owner_whatsapp || null,
  };
}
