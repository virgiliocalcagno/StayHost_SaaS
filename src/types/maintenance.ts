export type MaintenanceCategory =
  | "plumbing"
  | "electrical"
  | "appliance"
  | "furniture"
  | "structural"
  | "cleaning_supply"
  | "other";

export type MaintenanceSeverity = "low" | "medium" | "high" | "critical";

export type MaintenanceStatus =
  | "open"
  | "awaiting_response"
  | "confirmed"
  | "in_progress"
  | "pending_verification"
  | "resolved"
  | "invoiced"
  | "closed"
  | "dismissed";

export type TicketEventType =
  | "created"
  | "status_change"
  | "assignment"
  | "whatsapp_sent"
  | "whatsapp_received"
  | "internal_note"
  | "photo_request"
  | "escalation"
  | "attachment";

export interface TicketEvent {
  id: string;
  ticketId: string;
  eventType: TicketEventType;
  content: string | null;
  actorId: string | null;
  actorName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface MaintenanceTicket {
  id: string;
  propertyId: string;
  propertyName?: string | null;

  cleaningTaskId?: string | null;
  bookingId?: string | null;

  reportedById?: string | null;
  reportedByName?: string | null;
  reportedByAvatar?: string | null;

  title: string;
  description?: string | null;
  category: MaintenanceCategory;
  severity: MaintenanceSeverity;
  status: MaintenanceStatus;

  photos: string[];

  assigneeId?: string | null;
  assigneeName?: string | null;

  resolutionNotes?: string | null;
  resolvedAt?: string | null;

  createdAt: string;
  updatedAt: string;
}

export const MAINTENANCE_CATEGORY_LABELS: Record<MaintenanceCategory, string> = {
  plumbing: "Plomería",
  electrical: "Electricidad",
  appliance: "Electrodoméstico",
  furniture: "Mobiliario",
  structural: "Estructura",
  cleaning_supply: "Falta insumo",
  other: "Otro",
};

export const MAINTENANCE_SEVERITY_LABELS: Record<MaintenanceSeverity, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
};

export const MAINTENANCE_STATUS_LABELS: Record<MaintenanceStatus, string> = {
  open: "Abierto",
  awaiting_response: "Esperando respuesta",
  confirmed: "Confirmado",
  in_progress: "En progreso",
  pending_verification: "Pendiente verificar",
  resolved: "Resuelto",
  invoiced: "Facturado",
  closed: "Cerrado",
  dismissed: "Descartado",
};

// Orden del ciclo de vida — usado por la UI para mostrar el progreso del
// ticket como una barra / pills ordenadas.
export const MAINTENANCE_STATUS_ORDER: MaintenanceStatus[] = [
  "open",
  "awaiting_response",
  "confirmed",
  "in_progress",
  "pending_verification",
  "resolved",
  "invoiced",
  "closed",
];
