// Tipos del módulo de órdenes de Ventas Extras.
//
// Sprint 3 Fase B.1: el huésped crea una orden desde el Hub público,
// paga con PayPal automático, y el host la recibe vía email + dashboard.
// Snapshot inmutable: nombre y precio congelados al momento de compra.

import type { PricingModel } from "./upsell";

export type ServiceOrderStatus =
  | "pending"     // creada, esperando pago
  | "paid"        // pago capturado
  | "completed"   // servicio entregado (manual host)
  | "cancelled"   // cancelada antes de pagar
  | "refunded";

export interface ServiceOrderItem {
  id: string;
  upsellId: string | null;
  vendorId: string | null;
  name: string;                    // snapshot
  pricingModel: PricingModel;
  unitPrice: number;
  quantity: number;
  serviceDate: string | null;      // YYYY-MM-DD
  lineTotal: number;
}

export interface ServiceOrder {
  id: string;
  tenantId: string;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  status: ServiceOrderStatus;
  totalAmount: number;
  currency: string;
  paymentProvider: string | null;
  paymentId: string | null;
  paidAt: string | null;
  customerToken: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items?: ServiceOrderItem[];      // solo en respuestas que joinan
}

export const SERVICE_ORDER_STATUS_LABELS: Record<ServiceOrderStatus, string> = {
  pending: "Pendiente de pago",
  paid: "Pagada",
  completed: "Completada",
  cancelled: "Cancelada",
  refunded: "Reembolsada",
};
