import { NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

// GET /api/supervisor/team
// Equipo bajo coordinación del supervisor que llama. Admin ve todos los
// cleaners/maintenance del tenant. Supervisor ve solo los miembros con
// supervisor_id apuntando a su id de team_member.

interface MemberRow {
  id: string;
  name: string;
  phone: string | null;
  avatar_url: string | null;
  role: string;
  status: string;
  available: boolean;
  supervisor_id: string | null;
  last_active_at: string | null;
}

export async function GET() {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user || !tenantId) {
    return NextResponse.json({ error: "No tenant" }, { status: 403 });
  }

  const { data: viewerRow } = await supabase
    .from("team_members")
    .select("id, role")
    .eq("auth_user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const viewer = viewerRow as { id: string; role: string } | null;

  const isAdmin = !viewer || viewer.role === "admin";
  if (viewer && viewer.role !== "admin" && viewer.role !== "supervisor") {
    return NextResponse.json({ error: "Solo admin o supervisor" }, { status: 403 });
  }

  let query = supabase
    .from("team_members")
    .select("id, name, phone, avatar_url, role, status, available, supervisor_id, last_active_at")
    .eq("tenant_id", tenantId)
    .in("role", ["cleaner", "maintenance"])
    .order("name", { ascending: true });

  if (!isAdmin) {
    query = query.eq("supervisor_id", viewer!.id);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const members = (data as MemberRow[] | null ?? []).map(m => ({
    id: m.id,
    name: m.name,
    phone: m.phone ?? "",
    avatar: m.avatar_url ?? null,
    role: m.role,
    status: m.status,
    available: m.available,
    lastActive: m.last_active_at,
  }));

  return NextResponse.json({ members, viewerRole: viewer?.role ?? "admin" });
}
