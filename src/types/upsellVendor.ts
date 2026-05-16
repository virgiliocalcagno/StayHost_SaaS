// Tipos del directorio de proveedores de la tienda de Ventas Extras.
//
// Separado de service_vendors (mantenimiento/insumos/utilities) porque el
// dominio es distinto: estos son los que entregan el servicio al huésped
// (capitán catamarán, conductor PUJ, spa, chef privado).

import type { UpsellCategory, VendorPricingMethod } from "./upsellShared";

export type { UpsellCategory as UpsellVendorCategory, VendorPricingMethod };
export {
  UPSELL_CATEGORY_LABELS as UPSELL_VENDOR_CATEGORY_LABELS,
  VENDOR_PRICING_METHOD_LABELS,
  VENDOR_PRICING_VALUE_LABEL,
} from "./upsellShared";

export type PaymentTerms = "on_completion" | "pre_paid" | "split";

// Canales de notificación que el host puede habilitar por vendor (Sprint 7.6).
// El host puede activar cualquier combinación con checkboxes en el form.
export type VendorNotificationChannel =
  | "email"               // email automático (gratis, Gmail SMTP)
  | "push"                // Web Push PWA (gratis, instantáneo)
  | "whatsapp_manual"     // habilita botón WhatsApp en OrdersTab (manual)
  | "whatsapp_business";  // Meta Cloud API auto (requiere setup Meta + tokens)

export const VENDOR_NOTIFICATION_CHANNEL_META: Record<
  VendorNotificationChannel,
  { icon: string; label: string; hint: string; auto: boolean; status: "ready" | "pending_setup" }
> = {
  email: {
    icon: "📧",
    label: "Email automático",
    hint: "Constancia documental. Llega lento — no es operativo en LATAM.",
    auto: true,
    status: "ready",
  },
  push: {
    icon: "🔔",
    label: "Notificación Push (PWA)",
    hint: "Instantáneo en el celular del vendor. Requiere que abra el portal 1 vez para activar.",
    auto: true,
    status: "ready",
  },
  whatsapp_manual: {
    icon: "💬",
    label: "WhatsApp manual",
    hint: "Habilita el botón 'Avisar al vendor' en el panel Pedidos. Vos clickeás cuando querés.",
    auto: false,
    status: "ready",
  },
  whatsapp_business: {
    icon: "🌐",
    label: "WhatsApp Business (automático)",
    hint: "Mensaje auto vía Meta Cloud API. Requiere setup en Meta Business + número verificado + template aprobado.",
    auto: true,
    status: "pending_setup",
  },
};

export interface UpsellVendor {
  id: string;
  tenantId: string;

  // Identidad
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  rncCedula: string | null;

  category: UpsellCategory;

  // Cara pública (Hub)
  displayName: string | null;
  heroPhoto: string | null;
  description: string | null;
  languages: string[];

  // Comercial — defaults del trato.
  //   - default_pricing_method dice CÓMO le cobra al host por venta.
  //   - commission_percent (legacy, mantenido) se usa cuando method=commission.
  //   - default_fixed_cost se usa cuando method=fixed_cost.
  //   - default_flat_fee se usa cuando method=flat_fee.
  //   Cada producto puede override estos valores por su cuenta.
  defaultPricingMethod: VendorPricingMethod;
  commissionPercent: number;
  defaultFixedCost: number | null;
  defaultFlatFee: number | null;
  paymentTerms: PaymentTerms;

  // Sprint 7.6 — multi-canal de notificación. El host elige cualquier
  // combinación de canales por vendor.
  //   email             → email automático (gratis, Gmail SMTP)
  //   push              → Web Push PWA (gratis, instantáneo)
  //   whatsapp_manual   → habilita botón en OrdersTab (sin auto)
  //   whatsapp_business → WhatsApp Business API Meta Cloud (req setup)
  notificationChannels: VendorNotificationChannel[];

  // Contrato (Sprint 5)
  agreementAcceptedAt: string | null;
  agreementVersion: string | null;
  agreementPdfPath: string | null;
  acceptedByName: string | null;
  acceptedByIdDoc: string | null;

  // Operativo
  rating: number | null;
  totalOrders: number;
  active: boolean;
  notes: string | null;

  createdAt: string;
  updatedAt: string;
}

export const PAYMENT_TERMS_LABELS: Record<PaymentTerms, string> = {
  on_completion: "Al completar servicio",
  pre_paid: "Cobro adelantado",
  split: "Adelanto + saldo al completar",
};
