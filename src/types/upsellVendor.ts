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

  // Sprint 7 — cómo notificar al vendor cuando una orden pasa a paid.
  //   email          → email automático con link único al portal
  //   whatsapp_manual → el host clickea botón en OrdersTab (sin automático)
  //   both           → email auto + WhatsApp disponible (default)
  notificationPref: "email" | "whatsapp_manual" | "both";

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
