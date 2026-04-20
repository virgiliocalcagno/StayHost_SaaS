export type MaintenanceCategory =
  | "plumbing"
  | "electrical"
  | "appliance"
  | "furniture"
  | "structural"
  | "cleaning_supply"
  | "other";

export type MaintenanceSeverity = "low" | "medium" | "high" | "critical";

export type MaintenanceStatus = "open" | "in_progress" | "resolved" | "dismissed";

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
  in_progress: "En progreso",
  resolved: "Resuelto",
  dismissed: "Descartado",
};
