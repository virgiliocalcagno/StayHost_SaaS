// ─── Tipos exportados ────────────────────────────────────────────────────────

export interface RawTeamMember {
  id: string;
  name: string;
  role: string;
  avatar?: string;
  tasksToday?: number;
  tasksCompleted?: number;
  phone: string;
  available?: boolean;
  status?: string;
}

export interface RawProperty {
  id: string;
  name: string;
  address?: string;
  addressUnit?: string;
  neighborhood?: string;
  city?: string;
  image?: string;
  autoAssignCleaner?: boolean;
  cleanerPriorities?: string[];
  bedConfiguration?: string;
  standardInstructions?: string;
  evidenceCriteria?: string[];
  accessMethod?: "ttlock" | "keybox" | "in_person" | "doorman";
  keyboxCode?: string;
  keyboxLocation?: string;
  keyboxPhotoUrl?: string;
  keyboxShareWithGuest?: boolean;
  ttlockLockId?: string;
  [key: string]: unknown;
}

// ─── Team: reads from Supabase via API ───────────────────────────────────────

export async function getTeam(): Promise<RawTeamMember[]> {
  if (typeof window === "undefined") return [];
  try {
    const res = await fetch("/api/team-members", { credentials: "same-origin" });
    if (!res.ok) return [];
    const data = await res.json();
    type ApiMember = {
      id: string;
      name: string;
      role: string;
      avatar?: string | null;
      tasksToday?: number;
      tasksCompleted?: number;
      phone?: string;
      available?: boolean;
      status?: string;
    };
    return ((data.members ?? []) as ApiMember[]).map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      avatar: m.avatar ?? undefined,
      tasksToday: m.tasksToday ?? 0,
      tasksCompleted: m.tasksCompleted ?? 0,
      phone: m.phone ?? "",
      available: m.available ?? false,
      status: m.status ?? "pending",
    }));
  } catch {
    return [];
  }
}

// ─── Properties: reads from Supabase via API ─────────────────────────────────
//
// The API reads the tenant_id from the authenticated user's session cookie,
// so no tenant email needs to be sent from the client. A 401 means the user
// is not logged in — the middleware will redirect page routes to /acceso.

export async function getProperties(): Promise<RawProperty[]> {
  if (typeof window === "undefined") return [];
  try {
    const res = await fetch("/api/properties", { credentials: "same-origin" });
    if (!res.ok) return [];
    const data = await res.json();
    return ((data.properties ?? []) as any[]).map((p: any) => ({
      id: p.id,
      name: p.name,
      address: p.address ?? "",
      addressUnit: p.address_unit ?? undefined,
      neighborhood: p.neighborhood ?? undefined,
      city: p.city ?? undefined,
      image: p.cover_image ?? "",
      autoAssignCleaner: p.auto_assign_cleaner ?? false,
      cleanerPriorities: p.cleaner_priorities ?? [],
      bedConfiguration: p.bed_configuration ?? "",
      standardInstructions: p.standard_instructions ?? "",
      evidenceCriteria: p.evidence_criteria ?? [],
      accessMethod: (p.access_method as RawProperty["accessMethod"]) ?? "in_person",
      keyboxCode: p.keybox_code ?? undefined,
      keyboxLocation: p.keybox_location ?? undefined,
      keyboxPhotoUrl: p.keybox_photo_url ?? undefined,
      keyboxShareWithGuest: p.keybox_share_with_guest ?? true,
      ttlockLockId: p.ttlock_lock_id ?? undefined,
    }));
  } catch {
    return [];
  }
}
