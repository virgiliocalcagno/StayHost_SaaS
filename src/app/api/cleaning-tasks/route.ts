import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { ensureCleaningTasksForProperty } from "@/lib/cleaning/ensure-tasks";

// All handlers resolve the tenant from the authenticated session. Callers no
// longer pass `email` or `tenantEmail`. RLS ensures the tenant can only
// read / mutate their own cleaning tasks.

type Property = {
  id: string;
  name: string | null;
  address: string | null;
  auto_assign_cleaner: boolean | null;
  cleaner_priorities: unknown;
  bed_configuration: unknown;
  standard_instructions: string | null;
  evidence_criteria: unknown;
};

type CleaningTaskRow = {
  id: string;
  property_id: string;
  tenant_id: string;
  booking_id: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_avatar: string | null;
  due_date: string;
  due_time: string | null;
  status: string | null;
  priority: string | null;
  is_back_to_back: boolean | null;
  is_vacant: boolean | null;
  guest_name: string | null;
  guest_count: number | null;
  checklist_items: unknown;
  closure_photos: unknown;
  reported_issues: unknown;
  start_time: string | null;
  is_waiting_validation: boolean | null;
  rejection_reason: string | null;
  declined_by_ids: unknown;
  stay_duration: number | null;
  arriving_guest_name: string | null;
  arriving_guest_count: number | null;
};

// GET /api/cleaning-tasks
// Returns stored tasks + auto-generates from upcoming bookings checkouts
export async function GET() {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  // Load properties
  const { data: props } = await supabase
    .from("properties")
    .select("id, name, address, auto_assign_cleaner, cleaner_priorities, bed_configuration, standard_instructions, evidence_criteria")
    .eq("tenant_id", tenantId);

  const propList = (props ?? []) as Property[];
  const propMap: Record<string, Property> = {};
  for (const p of propList) propMap[p.id] = p;
  const propIds = Object.keys(propMap);
  if (!propIds.length) return NextResponse.json({ tasks: [] });

  // Asegurar que haya una task por cada booking activo. Antes se hacia
  // inline con una query que usaba `guests_count` (columna que no existe:
  // la real es `num_guests`), silenciando toda la auto-creacion. Ahora
  // delegamos al helper compartido — mismo que usa syncIcalForProperty
  // para no depender de que el host abra el modulo Limpiezas.
  for (const pid of propIds) {
    await ensureCleaningTasksForProperty({
      supabase,
      tenantId,
      propertyId: pid,
    });
  }

  // Return all tasks with property info
  const { data: allTasks } = await supabase
    .from("cleaning_tasks")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("due_date", { ascending: true });

  const result = ((allTasks ?? []) as CleaningTaskRow[]).map((t) => {
    const prop = propMap[t.property_id] ?? ({} as Partial<Property>);
    return {
      id: t.id,
      propertyId: t.property_id,
      propertyName: prop.name ?? "Propiedad",
      address: prop.address ?? "",
      assigneeId: t.assignee_id ?? undefined,
      assigneeName: t.assignee_name ?? undefined,
      assigneeAvatar: t.assignee_avatar ?? undefined,
      dueDate: t.due_date,
      dueTime: t.due_time ?? "11:00",
      status: t.status ?? "pending",
      priority: t.priority ?? "medium",
      isBackToBack: t.is_back_to_back ?? false,
      isVacant: t.is_vacant ?? false,
      guestName: t.guest_name ?? "Huésped",
      guestCount: t.guest_count ?? undefined,
      checklist: [],
      checklistItems: t.checklist_items ?? [],
      closurePhotos: t.closure_photos ?? [],
      reportedIssues: t.reported_issues ?? [],
      startTime: t.start_time ?? undefined,
      isWaitingValidation: t.is_waiting_validation ?? false,
      rejectionReason: t.rejection_reason ?? undefined,
      declinedByIds: t.declined_by_ids ?? [],
      acceptanceStatus:
        t.status === "accepted" ? "accepted" : t.status === "rejected" ? "declined" : "pending",
      standardInstructions: prop.standard_instructions ?? undefined,
      stayDuration: t.stay_duration ?? 2,
      arrivingGuestName: t.arriving_guest_name ?? undefined,
      arrivingGuestCount: t.arriving_guest_count ?? undefined,
    };
  });

  return NextResponse.json({ tasks: result });
}

// POST /api/cleaning-tasks — create manual task
export async function POST(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const {
      propertyId,
      dueDate,
      dueTime,
      guestName,
      priority,
      isBackToBack,
      isVacant,
      guestCount,
      assigneeId,
      assigneeName,
      assigneeAvatar,
    } = body;
    if (!propertyId || !dueDate) {
      return NextResponse.json(
        { error: "propertyId, dueDate required" },
        { status: 400 }
      );
    }

    const id = `task-${Date.now()}`;
    const { error } = await supabase.from("cleaning_tasks").insert({
      id,
      property_id: propertyId,
      tenant_id: tenantId,
      due_date: dueDate,
      due_time: dueTime ?? "11:00",
      status: assigneeId ? "assigned" : "unassigned",
      priority: priority ?? "medium",
      is_back_to_back: isBackToBack ?? false,
      is_vacant: isVacant ?? false,
      guest_name: guestName ?? "Huésped",
      guest_count: guestCount ?? null,
      assignee_id: assigneeId ?? null,
      assignee_name: assigneeName ?? null,
      assignee_avatar: assigneeAvatar ?? null,
      checklist_items: [
        { id: "c1", label: "Cambiar sábanas y toallas", done: false, type: "general" },
        { id: "c2", label: "Limpieza general", done: false, type: "general" },
        { id: "c3", label: "Verificar inventario", done: false, type: "general" },
        { id: "c4", label: "Control Remoto TV", done: false, type: "appliance" },
        { id: "c5", label: "Aire Acondicionado", done: false, type: "appliance" },
      ],
    } as never);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// PATCH /api/cleaning-tasks?id=... — update task fields
// RLS restricts the update to rows owned by the current tenant.
export async function PATCH(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    const body = await req.json();
    const update: Record<string, unknown> = {};
    if (body.status !== undefined) update.status = body.status;
    if (body.assigneeId !== undefined) update.assignee_id = body.assigneeId;
    if (body.assigneeName !== undefined) update.assignee_name = body.assigneeName;
    if (body.assigneeAvatar !== undefined) update.assignee_avatar = body.assigneeAvatar;
    if (body.startTime !== undefined) update.start_time = body.startTime;
    if (body.isWaitingValidation !== undefined) update.is_waiting_validation = body.isWaitingValidation;
    if (body.checklistItems !== undefined) update.checklist_items = body.checklistItems;
    if (body.closurePhotos !== undefined) update.closure_photos = body.closurePhotos;
    if (body.rejectionReason !== undefined) update.rejection_reason = body.rejectionReason;
    if (body.declinedByIds !== undefined) update.declined_by_ids = body.declinedByIds;
    if (body.reportedIssues !== undefined) update.reported_issues = body.reportedIssues;

    const { error, count } = await supabase
      .from("cleaning_tasks")
      .update(update as never, { count: "exact" })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// DELETE /api/cleaning-tasks?id=...
// RLS restricts the delete to rows owned by the current tenant.
export async function DELETE(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error, count } = await supabase
    .from("cleaning_tasks")
    .delete({ count: "exact" })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
