import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { ensureCleaningTasksForProperty } from "@/lib/cleaning/ensure-tasks";
import { deriveCorrectStatus } from "@/lib/cleaning/status";
import { syncStaffPinForTask } from "@/lib/staff-access/sync-task";

// All handlers resolve the tenant from the authenticated session. Callers no
// longer pass `email` or `tenantEmail`. RLS ensures the tenant can only
// read / mutate their own cleaning tasks.

type Property = {
  id: string;
  name: string | null;
  address: string | null;
  cover_image: string | null;
  auto_assign_cleaner: boolean | null;
  cleaner_priorities: unknown;
  bed_configuration: unknown;
  standard_instructions: string | null;
  evidence_criteria: unknown;
  access_method: string | null;
  keybox_code: string | null;
  keybox_location: string | null;
  wifi_name: string | null;
  wifi_password: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
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
  rejection_note: string | null;
  validated_at: string | null;
  validated_by: string | null;
  declined_by_ids: unknown;
  note: string | null;
  created_at: string | null;
};

// GET /api/cleaning-tasks
// Returns stored tasks + auto-generates from upcoming bookings checkouts
export async function GET() {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  // Load properties — selecciona también los campos que el panel /staff
  // necesita para que la limpiadora pueda llegar y entrar (acceso, wifi,
  // check-in time del próximo huésped en B2B).
  const { data: props } = await supabase
    .from("properties")
    .select(
      "id, name, address, cover_image, auto_assign_cleaner, cleaner_priorities, bed_configuration, standard_instructions, evidence_criteria, access_method, keybox_code, keybox_location, wifi_name, wifi_password, check_in_time, check_out_time"
    )
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

  const taskRows = (allTasks ?? []) as CleaningTaskRow[];

  // ── Owner WhatsApp del tenant — el staff lo necesita visible en cada
  // tarjeta para poder llamar/escribir si algo se rompe en la propiedad.
  let ownerWhatsapp: string | null = null;
  {
    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("owner_whatsapp")
      .eq("id", tenantId)
      .maybeSingle<{ owner_whatsapp: string | null }>();
    ownerWhatsapp = tenantRow?.owner_whatsapp ?? null;
  }

  // ── PINs de acceso por (assignee, property). Una query batch — evita
  // N+1. Se mapea por la clave compuesta `memberId|propertyId`.
  const assigneeIds = Array.from(
    new Set(taskRows.map((t) => t.assignee_id).filter((v): v is string => !!v)),
  );
  const accessPinMap = new Map<string, string>();
  if (assigneeIds.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: spaRows } = await (supabase.from("staff_property_access") as any)
      .select("team_member_id, property_id, pin_code")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .in("team_member_id", assigneeIds);
    for (const r of (spaRows ?? []) as Array<{
      team_member_id: string;
      property_id: string;
      pin_code: string | null;
    }>) {
      if (r.pin_code) {
        accessPinMap.set(`${r.team_member_id}|${r.property_id}`, r.pin_code);
      }
    }
  }

  // ── Información del huésped que llega (back-to-back). Para cada tarea
  // B2B, buscamos la reserva cuya check_in cae el día de la limpieza en
  // la misma propiedad. Una sola query por (property_id, due_date) que
  // tocan tareas B2B.
  const arrivingMap = new Map<
    string,
    { guest_name: string | null; num_guests: number | null }
  >();
  const b2bPropIds = Array.from(
    new Set(taskRows.filter((t) => t.is_back_to_back).map((t) => t.property_id)),
  );
  const b2bDates = Array.from(
    new Set(taskRows.filter((t) => t.is_back_to_back).map((t) => t.due_date)),
  );
  if (b2bPropIds.length && b2bDates.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: arrRows } = await (supabase.from("bookings") as any)
      .select("property_id, check_in, guest_name, num_guests")
      .in("property_id", b2bPropIds)
      .in("check_in", b2bDates);
    for (const r of (arrRows ?? []) as Array<{
      property_id: string;
      check_in: string;
      guest_name: string | null;
      num_guests: number | null;
    }>) {
      arrivingMap.set(`${r.property_id}|${r.check_in}`, {
        guest_name: r.guest_name,
        num_guests: r.num_guests,
      });
    }
  }

  // Enriquecer con datos de la reserva (channel_code, source, check_in)
  // para que la tarjeta del cronograma muestre el numero de reserva y la
  // estancia completa. Una sola query por todos los booking_ids — evita
  // N+1 cuando hay muchas tareas.
  const bookingIds = Array.from(
    new Set(taskRows.map((t) => t.booking_id).filter((v): v is string => !!v)),
  );
  const bookingMap: Record<
    string,
    { source: string | null; channel_code: string | null; check_in: string | null; check_out: string | null; guest_phone: string | null }
  > = {};
  if (bookingIds.length) {
    // channel_code/guest_phone son columnas opcionales — si la migracion
    // no esta aplicada en este entorno, hacemos fallback a las columnas
    // base. Asi no rompemos el GET en branches sin la migracion.
    const tryBookingsSelect = async (cols: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from("bookings") as any)
        .select(cols)
        .in("id", bookingIds);
      return { data, error };
    };
    let { data: bks, error: bkErr } = await tryBookingsSelect(
      "id, source, channel_code, check_in, check_out, guest_phone",
    );
    if (bkErr) {
      // 42703 = undefined_column. Reintenta con campos seguros.
      const r = await tryBookingsSelect("id, source, check_in, check_out");
      bks = r.data;
    }
    for (const b of (bks ?? []) as Array<{
      id: string;
      source: string | null;
      channel_code?: string | null;
      check_in: string | null;
      check_out: string | null;
      guest_phone?: string | null;
    }>) {
      bookingMap[b.id] = {
        source: b.source ?? null,
        channel_code: b.channel_code ?? null,
        check_in: b.check_in ?? null,
        check_out: b.check_out ?? null,
        guest_phone: b.guest_phone ?? null,
      };
    }
  }

  const result = taskRows.map((t) => {
    const prop = propMap[t.property_id] ?? ({} as Partial<Property>);
    const booking = t.booking_id ? bookingMap[t.booking_id] : null;
    const arriving = t.is_back_to_back
      ? arrivingMap.get(`${t.property_id}|${t.due_date}`) ?? null
      : null;
    // Stay duration: noches entre check_in y check_out de la reserva del
    // huésped que sale. Default 2 si la reserva no está disponible.
    let stayDuration = 2;
    if (booking?.check_in && booking?.check_out) {
      const ci = new Date(booking.check_in).getTime();
      const co = new Date(booking.check_out).getTime();
      const nights = Math.round((co - ci) / 86_400_000);
      if (nights > 0) stayDuration = nights;
    }
    const accessPin = t.assignee_id
      ? accessPinMap.get(`${t.assignee_id}|${t.property_id}`) ?? null
      : null;
    return {
      id: t.id,
      propertyId: t.property_id,
      propertyName: prop.name ?? "Propiedad",
      address: prop.address ?? "",
      propertyImage: prop.cover_image ?? undefined,
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
      rejectionNote: t.rejection_note ?? null,
      validatedAt: t.validated_at ?? null,
      validatedBy: t.validated_by ?? null,
      declinedByIds: t.declined_by_ids ?? [],
      acceptanceStatus:
        t.status === "accepted" ? "accepted" : t.status === "rejected" ? "declined" : "pending",
      standardInstructions: prop.standard_instructions ?? undefined,
      stayDuration,
      // Próximo huésped (back-to-back): viene de la reserva cuyo check_in
      // cae justo el día de esta limpieza. No es columna persistida.
      arrivingGuestName: arriving?.guest_name ?? undefined,
      arrivingGuestCount: arriving?.num_guests ?? undefined,
      // Hora de check-in del próximo huésped — heredada de la propiedad
      // (hoy no la guardamos por reserva, viene del default de la prop).
      arrivingCheckInTime: arriving ? prop.check_in_time ?? null : null,
      // Datos de la reserva asociada — alimentan el header de la tarjeta.
      bookingId: t.booking_id ?? undefined,
      bookingChannel: booking?.source ?? undefined,
      bookingChannelCode: booking?.channel_code ?? undefined,
      bookingCheckIn: booking?.check_in ?? undefined,
      bookingCheckOut: booking?.check_out ?? undefined,
      guestPhone: booking?.guest_phone ?? undefined,
      // ── Acceso a la propiedad — info crítica para que la limpiadora
      // sepa cómo entrar. Si access_method='ttlock', accessPin es el PIN
      // del staff_property_access (válido 8am-6pm el día de la tarea).
      accessMethod: prop.access_method ?? null,
      accessPin: accessPin,
      keyboxCode: prop.keybox_code ?? null,
      keyboxLocation: prop.keybox_location ?? null,
      wifiName: prop.wifi_name ?? null,
      wifiPassword: prop.wifi_password ?? null,
      checkInTime: prop.check_in_time ?? null,
      checkOutTime: prop.check_out_time ?? null,
      // Timestamp para el audit log del modal de detalle
      createdAt: t.created_at ?? undefined,
    };
  });

  return NextResponse.json({ tasks: result, ownerWhatsapp });
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

    // Si la nueva tarea ya quedó asignada, activar el PIN del staff.
    if (assigneeId) {
      try {
        const result = await syncStaffPinForTask({ supabase, tenantId, taskId: id });
        console.log("[cleaning-tasks POST] sync result:", result);
      } catch (e) {
        console.error("[cleaning-tasks POST] syncStaffPinForTask failed:", e);
      }
    }

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
    if (body.rejectionNote !== undefined) update.rejection_note = body.rejectionNote;
    if (body.validatedAt !== undefined) update.validated_at = body.validatedAt;
    if (body.validatedBy !== undefined) update.validated_by = body.validatedBy;
    if (body.declinedByIds !== undefined) update.declined_by_ids = body.declinedByIds;
    if (body.reportedIssues !== undefined) update.reported_issues = body.reportedIssues;

    // Coherencia status <-> assigneeId. Si el caller actualiza UNO solo de
    // los dos, leemos el otro de la fila actual y derivamos el status que
    // deberia quedar. Sin esto, un PATCH parcial puede dejar la fila con
    // assigneeId="x" + status="unassigned" (o el caso inverso).
    const touchesStatus = body.status !== undefined;
    const touchesAssignee = body.assigneeId !== undefined;
    if (touchesStatus !== touchesAssignee) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: current } = await (supabase.from("cleaning_tasks") as any)
        .select("status, assignee_id")
        .eq("id", id)
        .maybeSingle();
      if (current) {
        const merged = {
          status: touchesStatus ? (body.status as string) : (current.status as string),
          assigneeId: touchesAssignee
            ? (body.assigneeId ?? undefined)
            : (current.assignee_id ?? undefined),
        };
        const corrected = deriveCorrectStatus(merged);
        if (corrected) update.status = corrected;
      }
    }

    const { error, count } = await supabase
      .from("cleaning_tasks")
      .update(update as never, { count: "exact" })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Si la actualización tocó status o assignee, reconciliar el PIN de
    // staff en la cerradura. Idempotente — si nada cambió relevante para
    // el PIN, sale rápido.
    if (touchesStatus || touchesAssignee) {
      try {
        const result = await syncStaffPinForTask({ supabase, tenantId, taskId: id });
        console.log("[cleaning-tasks PATCH] sync result for", id, result);
      } catch (e) {
        console.error("[cleaning-tasks PATCH] syncStaffPinForTask failed:", e);
      }
    }

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
