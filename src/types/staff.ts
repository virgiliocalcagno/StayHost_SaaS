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
  isWaitingValidation?: boolean;
  closurePhotos?: { category: string; url: string }[];
  reportedIssues?: string[];
  suppliesReport?: { item: string; needed: number; status: "ok" | "missing" | "replenished" }[];
  checklistItems?: { id: string; label: string; done: boolean; type: "general" | "appliance" }[];
}

// Local date YYYY-MM-DD, NOT UTC — otherwise "today" rolls forward after 8pm
// in Chile / west-of-UTC timezones.
const toLocalDateStr = (d: Date) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

export const getPriorityInfo = (task: CleaningTask) => {
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
      isUrgent: true,
    };
  }
  if (isToday) {
    return {
      label: "HOY",
      color: "text-emerald-700 bg-emerald-100/50 border-emerald-200",
      isUrgent: false,
    };
  }
  if (isTomorrow) {
    return {
      label: "MAÑANA",
      color: "text-amber-700 bg-amber-100/50 border-amber-200",
      isUrgent: false,
    };
  }
  return {
    label: "PROGRAMADA",
    color: "text-slate-600 bg-slate-100 border-slate-200",
    isUrgent: false,
  };
};
