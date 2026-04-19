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
}

export interface RawProperty {
  id: string;
  name: string;
  address?: string;
  image?: string;
  autoAssignCleaner?: boolean;
  cleanerPriorities?: string[];
  bedConfiguration?: string;
  standardInstructions?: string;
  evidenceCriteria?: string[];
  [key: string]: unknown;
}

// ─── Team: reads from localStorage (configured via Team panel) ───────────────
// TODO: migrate the team roster to a Supabase table linked by tenant_id.

export async function getTeam(): Promise<RawTeamMember[]> {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem("stayhost_team");
    return raw ? (JSON.parse(raw) as RawTeamMember[]) : [];
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
      image: p.cover_image ?? "",
      autoAssignCleaner: p.auto_assign_cleaner ?? false,
      cleanerPriorities: p.cleaner_priorities ?? [],
      bedConfiguration: p.bed_configuration ?? "",
      standardInstructions: p.standard_instructions ?? "",
      evidenceCriteria: p.evidence_criteria ?? [],
    }));
  } catch {
    return [];
  }
}
