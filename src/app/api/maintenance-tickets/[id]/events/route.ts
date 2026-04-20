import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import type { TicketEvent, TicketEventType } from "@/types/maintenance";

type EventRow = {
  id: string;
  tenant_id: string;
  ticket_id: string;
  event_type: string;
  content: string | null;
  actor_id: string | null;
  actor_name: string | null;
  metadata: unknown;
  created_at: string;
};

function rowToEvent(row: EventRow): TicketEvent {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    eventType: row.event_type as TicketEventType,
    content: row.content,
    actorId: row.actor_id,
    actorName: row.actor_name,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at,
  };
}

// GET /api/maintenance-tickets/[id]/events
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }
  const { id: ticketId } = await params;

  const { data, error } = await supabase
    .from("ticket_events")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    events: (data ?? []).map((r) => rowToEvent(r as EventRow)),
  });
}

// POST /api/maintenance-tickets/[id]/events
// Crea un evento manualmente. Usado para: notas internas, mensajes de
// WhatsApp enviados (registrados manualmente cuando el operador usa wa.me),
// escalamientos, solicitudes de foto, respuestas del proveedor ingresadas
// manualmente ("proveedor me contestó que llega a las 3pm").
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }
  const { id: ticketId } = await params;

  try {
    const body = await req.json();
    const { eventType, content, actorId, actorName, metadata } = body;

    if (!eventType) {
      return NextResponse.json({ error: "eventType required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("ticket_events")
      .insert({
        tenant_id: tenantId,
        ticket_id: ticketId,
        event_type: eventType,
        content: content ?? null,
        actor_id: actorId ?? null,
        actor_name: actorName ?? null,
        metadata: metadata ?? {},
      } as never)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, event: rowToEvent(data as EventRow) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
