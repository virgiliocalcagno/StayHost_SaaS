import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import type { MaintenanceTicket } from "@/types/maintenance";

// All handlers resolve the tenant from the authenticated session and rely on
// RLS policies defined in 20260420_maintenance_tickets.sql.

type TicketRow = {
  id: string;
  tenant_id: string;
  property_id: string;
  cleaning_task_id: string | null;
  booking_id: string | null;
  reported_by_id: string | null;
  reported_by_name: string | null;
  reported_by_avatar: string | null;
  title: string;
  description: string | null;
  category: string;
  severity: string;
  status: string;
  photos: unknown;
  assignee_id: string | null;
  assignee_name: string | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

function rowToTicket(
  row: TicketRow,
  propertyName?: string | null
): MaintenanceTicket {
  return {
    id: row.id,
    propertyId: row.property_id,
    propertyName: propertyName ?? null,
    cleaningTaskId: row.cleaning_task_id,
    bookingId: row.booking_id,
    reportedById: row.reported_by_id,
    reportedByName: row.reported_by_name,
    reportedByAvatar: row.reported_by_avatar,
    title: row.title,
    description: row.description,
    category: row.category as MaintenanceTicket["category"],
    severity: row.severity as MaintenanceTicket["severity"],
    status: row.status as MaintenanceTicket["status"],
    photos: Array.isArray(row.photos) ? (row.photos as string[]) : [],
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name,
    resolutionNotes: row.resolution_notes,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/maintenance-tickets
// Optional query: ?status=open,in_progress  ?propertyId=...  ?cleaningTaskId=...
export async function GET(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  const statusParam = req.nextUrl.searchParams.get("status");
  const propertyId = req.nextUrl.searchParams.get("propertyId");
  const cleaningTaskId = req.nextUrl.searchParams.get("cleaningTaskId");

  let query = supabase
    .from("maintenance_tickets")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (statusParam) {
    const statuses = statusParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (statuses.length) query = query.in("status", statuses);
  }
  if (propertyId) query = query.eq("property_id", propertyId);
  if (cleaningTaskId) query = query.eq("cleaning_task_id", cleaningTaskId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Join property names in a single extra query (avoids N+1, avoids requiring
  // an FK join that RLS may complicate).
  const propIds = Array.from(new Set((data ?? []).map((r) => r.property_id)));
  const propNames = new Map<string, string>();
  if (propIds.length) {
    const { data: props } = await supabase
      .from("properties")
      .select("id, name")
      .in("id", propIds);
    (props ?? []).forEach((p: { id: string; name: string | null }) => {
      if (p.name) propNames.set(p.id, p.name);
    });
  }

  const tickets = (data ?? []).map((row) =>
    rowToTicket(row as TicketRow, propNames.get(row.property_id))
  );
  return NextResponse.json({ tickets });
}

// POST /api/maintenance-tickets
export async function POST(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const {
      propertyId,
      cleaningTaskId,
      bookingId,
      reportedById,
      reportedByName,
      reportedByAvatar,
      title,
      description,
      category,
      severity,
      photos,
      assigneeId,
      assigneeName,
    } = body;

    if (!propertyId || !title) {
      return NextResponse.json(
        { error: "propertyId and title are required" },
        { status: 400 }
      );
    }

    const insert = {
      tenant_id: tenantId,
      property_id: propertyId,
      cleaning_task_id: cleaningTaskId ?? null,
      booking_id: bookingId ?? null,
      reported_by_id: reportedById ?? null,
      reported_by_name: reportedByName ?? null,
      reported_by_avatar: reportedByAvatar ?? null,
      title,
      description: description ?? null,
      category: category ?? "other",
      severity: severity ?? "medium",
      photos: Array.isArray(photos) ? photos : [],
      assignee_id: assigneeId ?? null,
      assignee_name: assigneeName ?? null,
    };

    const { data, error } = await supabase
      .from("maintenance_tickets")
      .insert(insert as never)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Evento inicial del timeline. Si viene de una tarea de limpieza el
    // mensaje lo refleja; si es manual, lo indica también.
    const createdRow = data as TicketRow;
    const origin = createdRow.cleaning_task_id
      ? "Reportado desde tarea de limpieza"
      : "Creado manualmente";
    await supabase.from("ticket_events").insert({
      tenant_id: tenantId,
      ticket_id: createdRow.id,
      event_type: "created",
      content: origin,
      actor_id: reportedById ?? null,
      actor_name: reportedByName ?? null,
      metadata: { severity, category },
    } as never);

    return NextResponse.json({ ok: true, ticket: rowToTicket(createdRow) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// PATCH /api/maintenance-tickets?id=...
// Al cambiar status o assignee emitimos un evento en ticket_events para que
// el timeline del detalle refleje la acción sin requerir que el frontend la
// registre por separado (source of truth único en el backend).
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
    if (body.title !== undefined) update.title = body.title;
    if (body.description !== undefined) update.description = body.description;
    if (body.category !== undefined) update.category = body.category;
    if (body.severity !== undefined) update.severity = body.severity;
    if (body.status !== undefined) update.status = body.status;
    if (body.photos !== undefined) update.photos = body.photos;
    if (body.assigneeId !== undefined) update.assignee_id = body.assigneeId;
    if (body.assigneeName !== undefined) update.assignee_name = body.assigneeName;
    if (body.resolutionNotes !== undefined) update.resolution_notes = body.resolutionNotes;

    // Leemos el estado previo ANTES de actualizar para saber de qué a qué
    // cambió. Una sola round-trip extra es aceptable por la claridad que
    // da en el timeline.
    const { data: prev } = await supabase
      .from("maintenance_tickets")
      .select("status, assignee_id, assignee_name")
      .eq("id", id)
      .single();

    const { error, count } = await supabase
      .from("maintenance_tickets")
      .update(update as never, { count: "exact" })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Emitir eventos de timeline. Best-effort — si el insert falla no
    // revertimos el PATCH.
    const prevRow = prev as { status?: string; assignee_id?: string | null; assignee_name?: string | null } | null;
    const events: Array<Record<string, unknown>> = [];
    const actorName: string | null = body.actorName ?? null;
    const actorId: string | null = body.actorId ?? null;

    if (body.status !== undefined && prevRow && prevRow.status !== body.status) {
      events.push({
        tenant_id: tenantId,
        ticket_id: id,
        event_type: "status_change",
        content: `Estado: ${prevRow.status} → ${body.status}`,
        actor_id: actorId,
        actor_name: actorName,
        metadata: { from: prevRow.status, to: body.status },
      });
    }

    if (
      body.assigneeId !== undefined &&
      prevRow &&
      (prevRow.assignee_id ?? null) !== (body.assigneeId ?? null)
    ) {
      const newName = body.assigneeName ?? "sin nombre";
      events.push({
        tenant_id: tenantId,
        ticket_id: id,
        event_type: "assignment",
        content: body.assigneeId
          ? `Asignado a ${newName}`
          : `Asignación removida (antes: ${prevRow.assignee_name ?? "—"})`,
        actor_id: actorId,
        actor_name: actorName,
        metadata: {
          vendor_id: body.assigneeId ?? null,
          vendor_name: body.assigneeName ?? null,
        },
      });
    }

    if (events.length > 0) {
      await supabase.from("ticket_events").insert(events as never);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

// DELETE /api/maintenance-tickets?id=...
export async function DELETE(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error, count } = await supabase
    .from("maintenance_tickets")
    .delete({ count: "exact" })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
