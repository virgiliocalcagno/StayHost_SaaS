import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;

// ── helpers ──────────────────────────────────────────────────────────────────

async function getTenant(email: string) {
  const { data } = await supabaseAdmin.from("tenants").select("id").eq("email", email).single();
  return data as { id: string } | null;
}

// GET /api/cleaning-tasks?email=...
// Returns stored tasks + auto-generates from upcoming bookings checkouts
export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const tenant = await getTenant(email);
  if (!tenant) return NextResponse.json({ tasks: [] });

  // Load properties
  const { data: props } = await supabaseAdmin
    .from("properties")
    .select("id, name, address, auto_assign_cleaner, cleaner_priorities, bed_configuration, standard_instructions, evidence_criteria")
    .eq("tenant_id", tenant.id);

  const propMap: Record<string, any> = {};
  for (const p of (props ?? []) as any[]) propMap[p.id] = p;
  const propIds = Object.keys(propMap);
  if (!propIds.length) return NextResponse.json({ tasks: [] });

  // Load existing cleaning tasks
  const { data: storedTasks } = await db
    .from("cleaning_tasks")
    .select("*")
    .eq("tenant_id", tenant.id);

  const existingBookingIds = new Set(
    ((storedTasks ?? []) as any[]).map((t: any) => t.booking_id).filter(Boolean)
  );

  // Load ALL bookings (not just checkouts) to cross-reference entries
  const today = new Date();
  today.setDate(today.getDate() - 14); // Wider range for duration calcs
  const cutoff = today.toISOString().split("T")[0];

  const { data: bookings } = await supabaseAdmin
    .from("bookings")
    .select("id, property_id, guest_name, check_in, check_out, source, guests_count")
    .in("property_id", propIds)
    .gte("check_out", cutoff)
    .neq("status", "cancelled")
    .neq("source", "block");

  // Map bookings by property for fast lookup
  const bookingsByProp: Record<string, any[]> = {};
  for (const b of (bookings ?? []) as any[]) {
    if (!bookingsByProp[b.property_id]) bookingsByProp[b.property_id] = [];
    bookingsByProp[b.property_id].push(b);
  }

  // Auto-create tasks for bookings that don't have one yet
  const newTasks: any[] = [];
  for (const b of (bookings ?? []) as any[]) {
    const taskId = `booking-${b.id}`;
    if (existingBookingIds.has(b.id)) continue;

    const propBookings = bookingsByProp[b.property_id] ?? [];
    const arrivingBooking = propBookings.find((o: any) => o.id !== b.id && o.check_in === b.check_out);
    const isBackToBack = !!arrivingBooking;
    const isVacant = !isBackToBack;

    // Calculate nights
    const outDate = new Date(b.check_out);
    const inDate = new Date(b.check_in);
    const nights = Math.ceil((outDate.getTime() - inDate.getTime()) / (1000 * 60 * 60 * 24));

    newTasks.push({
      id: taskId,
      property_id: b.property_id,
      tenant_id: tenant.id,
      booking_id: b.id,
      due_date: b.check_out,
      due_time: "11:00",
      status: "pending",
      priority: isBackToBack ? "critical" : "medium",
      is_back_to_back: isBackToBack,
      is_vacant: isVacant,
      guest_name: b.guest_name ?? "Huésped",
      guest_count: b.guests_count ?? null,
      stay_duration: nights,
      // Metadata enrichment from the arriving guest
      arriving_guest_name: arrivingBooking?.guest_name ?? null,
      arriving_guest_count: arrivingBooking?.guests_count ?? null,
      checklist_items: [
        { id: "c1", label: "Cambiar sábanas y toallas", done: false, type: "general" },
        { id: "c2", label: "Limpieza general", done: false, type: "general" },
        { id: "c3", label: "Verificar inventario", done: false, type: "general" },
        { id: "c4", label: "Control Remoto TV", done: false, type: "appliance" },
        { id: "c5", label: "Aire Acondicionado", done: false, type: "appliance" },
      ],
    });
  }

  if (newTasks.length) {
    await db.from("cleaning_tasks").upsert(newTasks, { onConflict: "id", ignoreDuplicates: true });
  }

  // Return all tasks with property info
  const { data: allTasks } = await db
    .from("cleaning_tasks")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("due_date", { ascending: true });

  const result = ((allTasks ?? []) as any[]).map((t: any) => {
    const prop = propMap[t.property_id] ?? {};
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
      acceptanceStatus: (t.status === "accepted" ? "accepted" : t.status === "rejected" ? "declined" : "pending") as any,
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
  try {
    const body = await req.json();
    const { tenantEmail, propertyId, dueDate, dueTime, guestName, priority, isBackToBack, isVacant, guestCount, assigneeId, assigneeName, assigneeAvatar } = body;
    if (!tenantEmail || !propertyId || !dueDate) {
      return NextResponse.json({ error: "tenantEmail, propertyId, dueDate required" }, { status: 400 });
    }
    const tenant = await getTenant(tenantEmail);
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

    const id = `task-${Date.now()}`;
    const { error } = await db.from("cleaning_tasks").insert({
      id,
      property_id: propertyId,
      tenant_id: tenant.id,
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
    } as any);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, id });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

// PATCH /api/cleaning-tasks?id=... — update task fields
export async function PATCH(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    const body = await req.json();
    const update: Record<string, any> = {};
    if (body.status !== undefined)              update.status = body.status;
    if (body.assigneeId !== undefined)          update.assignee_id = body.assigneeId;
    if (body.assigneeName !== undefined)        update.assignee_name = body.assigneeName;
    if (body.assigneeAvatar !== undefined)      update.assignee_avatar = body.assigneeAvatar;
    if (body.startTime !== undefined)           update.start_time = body.startTime;
    if (body.isWaitingValidation !== undefined) update.is_waiting_validation = body.isWaitingValidation;
    if (body.checklistItems !== undefined)      update.checklist_items = body.checklistItems;
    if (body.closurePhotos !== undefined)       update.closure_photos = body.closurePhotos;
    if (body.rejectionReason !== undefined)     update.rejection_reason = body.rejectionReason;
    if (body.declinedByIds !== undefined)       update.declined_by_ids = body.declinedByIds;
    if (body.reportedIssues !== undefined)      update.reported_issues = body.reportedIssues;

    const { error } = await db.from("cleaning_tasks").update(update).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

// DELETE /api/cleaning-tasks?id=...
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await db.from("cleaning_tasks").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
