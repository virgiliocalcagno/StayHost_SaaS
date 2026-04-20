/**
 * /api/team-members — CRUD para el panel de Equipo.
 *
 * Todas las operaciones filtran por tenant vía RLS (`current_tenant_id()`).
 * El cliente envía el objeto del UI tal cual; aquí hacemos el mapeo a
 * columnas snake_case de Postgres.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

type TeamRow = {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  role: string;
  status: string;
  available: boolean;
  document_id: string | null;
  emergency_phone: string | null;
  address: string | null;
  references_json: { name: string; phone: string }[] | null;
  document_photo_url: string | null;
  perm_view_analytics: boolean;
  perm_manage_tasks: boolean;
  perm_message_guests: boolean;
  perm_edit_properties: boolean;
  property_access: unknown; // "all" | string[]
  notif_whatsapp: boolean;
  notif_email: boolean;
  properties_count: number;
  tasks_completed: number;
  tasks_today: number;
  rating: number;
  join_date: string;
  last_active_at: string | null;
  created_at: string;
  updated_at: string;
};

// Forma que espera el UI (espejo del interface TeamMember en TeamPanel.tsx).
function rowToDto(row: TeamRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone ?? "",
    avatar: row.avatar_url ?? undefined,
    role: row.role,
    status: row.status,
    available: row.available,
    properties: row.properties_count,
    tasksCompleted: row.tasks_completed,
    tasksToday: row.tasks_today,
    rating: Number(row.rating ?? 0),
    joinDate: row.join_date,
    lastActive: row.last_active_at ?? "",
    permissions: {
      canViewAnalytics: row.perm_view_analytics,
      canManageTasks: row.perm_manage_tasks,
      canMessageGuests: row.perm_message_guests,
      canEditProperties: row.perm_edit_properties,
    },
    propertyAccess:
      Array.isArray(row.property_access)
        ? (row.property_access as string[])
        : "all",
    notificationPrefs: {
      whatsapp: row.notif_whatsapp,
      email: row.notif_email,
    },
    documentId: row.document_id ?? undefined,
    emergencyPhone: row.emergency_phone ?? undefined,
    address: row.address ?? undefined,
    references: row.references_json ?? [],
    documentPhoto: row.document_photo_url ?? undefined,
  };
}

// Inverso: toma el objeto del UI y produce el payload para la DB.
type InboundBody = {
  name?: string;
  email?: string;
  phone?: string;
  avatar?: string;
  role?: string;
  status?: string;
  available?: boolean;
  properties?: number;
  tasksCompleted?: number;
  tasksToday?: number;
  rating?: number;
  joinDate?: string;
  lastActive?: string;
  permissions?: {
    canViewAnalytics?: boolean;
    canManageTasks?: boolean;
    canMessageGuests?: boolean;
    canEditProperties?: boolean;
  };
  propertyAccess?: "all" | string[];
  notificationPrefs?: { whatsapp?: boolean; email?: boolean };
  documentId?: string;
  emergencyPhone?: string;
  address?: string;
  references?: { name: string; phone: string }[];
  documentPhoto?: string;
};

function dtoToRow(body: InboundBody) {
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.email !== undefined) patch.email = String(body.email).trim().toLowerCase();
  if (body.phone !== undefined) patch.phone = body.phone || null;
  if (body.avatar !== undefined) patch.avatar_url = body.avatar || null;
  if (body.role !== undefined) patch.role = body.role;
  if (body.status !== undefined) patch.status = body.status;
  if (body.available !== undefined) patch.available = body.available;
  if (body.properties !== undefined) patch.properties_count = body.properties;
  if (body.tasksCompleted !== undefined) patch.tasks_completed = body.tasksCompleted;
  if (body.tasksToday !== undefined) patch.tasks_today = body.tasksToday;
  if (body.rating !== undefined) patch.rating = body.rating;
  if (body.joinDate !== undefined) patch.join_date = body.joinDate;
  if (body.lastActive !== undefined) patch.last_active_at = body.lastActive || null;

  if (body.permissions) {
    if (body.permissions.canViewAnalytics !== undefined) patch.perm_view_analytics = body.permissions.canViewAnalytics;
    if (body.permissions.canManageTasks !== undefined) patch.perm_manage_tasks = body.permissions.canManageTasks;
    if (body.permissions.canMessageGuests !== undefined) patch.perm_message_guests = body.permissions.canMessageGuests;
    if (body.permissions.canEditProperties !== undefined) patch.perm_edit_properties = body.permissions.canEditProperties;
  }
  if (body.propertyAccess !== undefined) {
    patch.property_access =
      body.propertyAccess === "all" ? "all" : body.propertyAccess;
  }
  if (body.notificationPrefs) {
    if (body.notificationPrefs.whatsapp !== undefined) patch.notif_whatsapp = body.notificationPrefs.whatsapp;
    if (body.notificationPrefs.email !== undefined) patch.notif_email = body.notificationPrefs.email;
  }

  if (body.documentId !== undefined) patch.document_id = body.documentId || null;
  if (body.emergencyPhone !== undefined) patch.emergency_phone = body.emergencyPhone || null;
  if (body.address !== undefined) patch.address = body.address || null;
  if (body.references !== undefined) patch.references_json = body.references;
  if (body.documentPhoto !== undefined) patch.document_photo_url = body.documentPhoto || null;

  return patch;
}

// GET /api/team-members
export async function GET() {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) return NextResponse.json({ error: "No tenant" }, { status: 403 });

  const { data, error } = await supabase
    .from("team_members")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    members: (data as TeamRow[] | null ?? []).map(rowToDto),
  });
}

// POST /api/team-members — crear
export async function POST(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) return NextResponse.json({ error: "No tenant" }, { status: 403 });

  let body: InboundBody;
  try { body = (await req.json()) as InboundBody; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.name || !body.email) {
    return NextResponse.json({ error: "name y email son requeridos" }, { status: 400 });
  }

  const row = dtoToRow(body);
  row.tenant_id = tenantId;
  // Defaults si el cliente no los envía.
  if (row.status === undefined) row.status = "pending";
  if (row.available === undefined) row.available = false;

  const { data, error } = await supabase
    .from("team_members")
    .insert(row as never)
    .select("*")
    .single();

  if (error) {
    // 23505 = duplicado (email+tenant único)
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "Ya existe un miembro con ese email" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ member: rowToDto(data as TeamRow) });
}

// PATCH /api/team-members?id=xxx — actualizar
export async function PATCH(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) return NextResponse.json({ error: "No tenant" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  let body: InboundBody;
  try { body = (await req.json()) as InboundBody; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const patch = dtoToRow(body);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("team_members")
    .update(patch as never)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ member: rowToDto(data as TeamRow) });
}

// DELETE /api/team-members?id=xxx
export async function DELETE(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) return NextResponse.json({ error: "No tenant" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error, count } = await supabase
    .from("team_members")
    .delete({ count: "exact" })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
