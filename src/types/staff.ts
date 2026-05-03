export interface CleaningTask {
  id: string;
  propertyId: string;
  propertyName: string;
  address: string;
  propertyImage?: string;
  assigneeId?: string;
  assigneeName?: string;
  assigneeAvatar?: string;
  dueDate: string; // ISO Date String
  dueTime: string;
  status: "pending" | "in_progress" | "completed" | "issue" | "unassigned" | "assigned" | "accepted" | "rejected";
  priority: "low" | "medium" | "high" | "critical";
  isBackToBack: boolean;
  isVacant?: boolean;
  guestCount?: number;
  guestName: string;
  guestPhone?: string;
  checklist: { id: number; task: string; done: boolean }[];
  incidentReport?: string;
  rejectionReason?: string;
  declinedByIds?: string[];
  standardInstructions?: string;
  arrivalDate?: string;
  stayDuration?: number;
  acceptanceStatus?: "pending" | "accepted" | "declined";
  startTime?: string;
  arrivingGuestName?: string;
  arrivingGuestCount?: number;
  arrivingCheckInTime?: string | null;
  isWaitingValidation?: boolean;
  closurePhotos?: { category: string; url: string }[];
  reportedIssues?: string[];
  suppliesReport?: { item: string; needed: number; status: "ok" | "missing" | "replenished" }[];
  checklistItems?: { id: string; label: string; done: boolean; type: "general" | "appliance" }[];
  // Acceso a la propiedad — el staff lo necesita para entrar.
  accessMethod?: "ttlock" | "keybox" | "in_person" | "doorman" | string | null;
  accessPin?: string | null;
  keyboxCode?: string | null;
  keyboxLocation?: string | null;
  wifiName?: string | null;
  wifiPassword?: string | null;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  // Datos de la reserva asociada
  bookingId?: string;
  bookingChannel?: string;
  bookingChannelCode?: string;
  bookingCheckIn?: string;
  bookingCheckOut?: string;
}

// Local date YYYY-MM-DD, NOT UTC — otherwise "today" rolls forward after 8pm
// in Chile / west-of-UTC timezones.
const toLocalDateStr = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

export interface PriorityInfo {
  label: string;
  color: string;
  borderColor: string;
  isUrgent: boolean;
}

export const getPriorityInfo = (task: CleaningTask): PriorityInfo => {
  const d = new Date();
  const todayStr = toLocalDateStr(d);
  d.setDate(d.getDate() + 1);
  const tomorrowStr = toLocalDateStr(d);

  const isToday = task.dueDate === todayStr;
  const isTomorrow = task.dueDate === tomorrowStr;
  const [hoursStr] = task.dueTime.split(":");
  const hours = parseInt(hoursStr);

  if ((isToday && hours < 6) || task.priority === "critical") {
    return {
      label: "¡URGENTE!",
      color: "text-white bg-rose-600 border-none animate-pulse",
      borderColor: "bg-rose-600",
      isUrgent: true,
    };
  }
  if (isToday) {
    return {
      label: "PRIORIDAD ALTA",
      color: "text-rose-600 bg-rose-50 border-rose-200",
      borderColor: "bg-rose-400",
      isUrgent: false,
    };
  }
  if (isTomorrow) {
    return {
      label: "PRIORIDAD MEDIA",
      color: "text-amber-600 bg-amber-50 border-amber-200",
      borderColor: "bg-amber-400",
      isUrgent: false,
    };
  }
  return {
    label: "BAJA",
    color: "text-emerald-600 bg-emerald-50 border-emerald-200",
    borderColor: "bg-emerald-400",
    isUrgent: false,
  };
};
