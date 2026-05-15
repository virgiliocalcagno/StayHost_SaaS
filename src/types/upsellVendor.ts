// Tipos del directorio de proveedores de la tienda de Ventas Extras.
//
// Separado de service_vendors (mantenimiento/insumos/utilities) porque el
// dominio es distinto: estos son los que entregan el servicio al huésped
// (capitán catamarán, conductor PUJ, spa, chef privado). Tienen campos de
// marca pública, comisión y contrato que el directorio operativo no necesita.

export type UpsellVendorCategory =
  | "excursion"      // tours, catamarán, buggy, snorkel, parasailing
  | "transport"      // shuttle aeropuerto, traslados internos
  | "food"           // chef privado, catering, barman
  | "laundry"        // lavandería, recogida domicilio
  | "spa"            // masajes, manicura, peluquería
  | "concierge"      // niñera, médico, reservas, guía
  | "other";

export type PaymentTerms = "on_completion" | "pre_paid" | "split";

export interface UpsellVendor {
  id: string;
  tenantId: string;

  // Identidad
  name: string;
  contactName: string | null;
  phone: string | null;          // E.164 para WhatsApp deep-link
  email: string | null;
  rncCedula: string | null;      // facturación

  category: UpsellVendorCategory;

  // Cara pública (Hub)
  displayName: string | null;    // si null, usa `name`
  heroPhoto: string | null;      // URL Storage (Sprint 2)
  description: string | null;
  languages: string[];           // ["es", "en", "fr"]

  // Comercial
  commissionPercent: number;     // 0..100. % que retiene el host del precio
  paymentTerms: PaymentTerms;

  // Contrato (Sprint 5)
  agreementAcceptedAt: string | null;
  agreementVersion: string | null;
  agreementPdfPath: string | null;
  acceptedByName: string | null;
  acceptedByIdDoc: string | null;

  // Operativo
  rating: number | null;         // 1.0..5.0, promedio reviews
  totalOrders: number;
  active: boolean;
  notes: string | null;

  createdAt: string;
  updatedAt: string;
}

export const UPSELL_VENDOR_CATEGORY_LABELS: Record<UpsellVendorCategory, string> = {
  excursion: "🌴 Excursiones",
  transport: "🚗 Transporte",
  food: "🍽️ Gastronomía",
  laundry: "🧺 Lavandería",
  spa: "💆 Spa / Bienestar",
  concierge: "🛎️ Concierge",
  other: "📦 Otro",
};

export const PAYMENT_TERMS_LABELS: Record<PaymentTerms, string> = {
  on_completion: "Al completar servicio",
  pre_paid: "Cobro adelantado",
  split: "Adelanto + saldo al completar",
};
