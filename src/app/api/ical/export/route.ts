import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// GET /api/ical/export?id=[propertyId]&type=[bookings|tasks]
// Returns an iCal feed with enriched data.
//
// This endpoint is intentionally public so that external platforms (Airbnb,
// Google Calendar, etc.) can subscribe. It uses the admin client to read
// property data regardless of the requester's session. Future work: require
// the `ical_token` column to be passed as a query param so the URL is
// capability-based rather than just knowing the property id.

type PropertyRow = {
  id: string;
  name: string | null;
  address: string | null;
  city: string | null;
  max_guests: number | null;
  standard_instructions: string | null;
  bed_configuration: unknown;
};

type TaskRow = {
  id: string;
  due_date: string;
  guest_name: string | null;
  priority: string | null;
  checklist_items: { label?: string }[] | null;
};

type BookingRow = {
  id: string;
  source_uid: string | null;
  guest_name: string | null;
  check_in: string;
  check_out: string;
  source: string | null;
  status: string | null;
  num_guests: number | null;
  note: string | null;
};

export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("id");
  const type = req.nextUrl.searchParams.get("type") || "bookings";

  if (!propertyId) {
    return new NextResponse("id required", { status: 400 });
  }

  // Fetch property details
  const { data: property, error: propErr } = await supabaseAdmin
    .from("properties")
    .select("id, name, address, city, max_guests, standard_instructions, bed_configuration")
    .eq("id", propertyId)
    .single<PropertyRow>();

  if (!property || propErr) {
    return new NextResponse("Property not found", { status: 404 });
  }

  const prop = property;
  const toIcalDate = (iso: string) => iso.replace(/-/g, "");
  const now = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  let events = "";
  let calName = "";

  if (type === "tasks") {
    // ── Export Cleanings ([C]) ───────────────────────────────────────────────
    calName = `StayHost Cleanings - ${prop.name ?? ""}`;

    const { data: tasks } = await supabaseAdmin
      .from("cleaning_tasks")
      .select("id, due_date, guest_name, priority, checklist_items")
      .eq("property_id", propertyId)
      .neq("status", "cancelled")
      .order("due_date", { ascending: true })
      .returns<TaskRow[]>();

    events = (tasks || [])
      .map((t) => {
        const summary = `[C] — ${prop.name ?? ""}`;
        const checklist = (t.checklist_items || [])
          .map((item) => `- ${item.label ?? ""}`)
          .join("\\n");

        const descriptionLines = [
          `Instrucciones: ${prop.standard_instructions || "No hay instrucciones específicas."}`,
          `Camas: ${prop.bed_configuration || "No especificado"}`,
          `Huésped: ${t.guest_name || "N/A"}`,
          `Prioridad: ${t.priority || "Normal"}`,
          `Checklist:\\n${checklist}`,
        ];

        // iCal DATE duration: DTEND is exclusive, so for a 1-day event, add 1 day
        const d = new Date(t.due_date);
        d.setDate(d.getDate() + 1);
        const nextDay = d.toISOString().split("T")[0].replace(/-/g, "");

        return [
          "BEGIN:VEVENT",
          `DTSTAMP:${now}`,
          `DTSTART;VALUE=DATE:${toIcalDate(t.due_date)}`,
          `DTEND;VALUE=DATE:${nextDay}`,
          `SUMMARY:${summary}`,
          `LOCATION:${prop.address || ""}, ${prop.city || ""}`,
          `DESCRIPTION:${descriptionLines.join("\\n")}`,
          `UID:stayhost-task-${t.id}`,
          "END:VEVENT",
        ].join("\r\n");
      })
      .join("\r\n");
  } else {
    // ── Export Bookings ([B]) ────────────────────────────────────────────────
    calName = `StayHost Bookings - ${prop.name ?? ""}`;

    const { data: bookings } = await supabaseAdmin
      .from("bookings")
      .select("id, source_uid, guest_name, check_in, check_out, source, status, num_guests, note")
      .eq("property_id", propertyId)
      .neq("status", "cancelled")
      .returns<BookingRow[]>();

    // CRITICO: NO re-exportar reservas/bloqueos importados de canales
    // externos. Airbnb (y otros) detectan sus propios UIDs en el feed
    // entrante y rechazan TODO el calendario para prevenir un loop
    // (mismo evento yendo y viniendo entre plataformas).
    //
    // Solo exportamos lo que se origino en StayHost:
    //   - reservas directas (source = 'direct' o 'manual')
    //   - bloqueos manuales del host (source = 'block' AND source_uid empieza con 'manual-')
    //
    // Las reservas/bloqueos que vinieron de Airbnb/VRBO/Booking ya estan
    // en esos canales — no tiene sentido re-enviarlas.
    const externalChannels = new Set(["airbnb", "vrbo", "booking"]);
    const ownEvents = (bookings || []).filter((b) => {
      if (b.source && externalChannels.has(b.source)) return false;
      // Bloqueos importados de iCal: source='block' con UID externo (@ en source_uid)
      if (b.source === "block" && b.source_uid && b.source_uid.includes("@")) return false;
      return true;
    });

    events = ownEvents
      .map((b) => {
        const isBlock = b.source === "block" || b.status === "blocked";
        // Para Airbnb/VRBO no exponemos el nombre del huesped ni el canal de
        // origen — es informacion del competidor. Igualamos el SUMMARY al
        // mismo formato que ellos usan ("Reserved" / "Not available") para
        // evitar que rechacen el feed.
        const summary = isBlock ? "Not available" : "Reserved";

        const descriptionLines = [
          `StayHost — ${prop.name ?? ""}`,
          `Check-in: ${b.check_in}`,
          `Check-out: ${b.check_out}`,
        ];
        if (!isBlock && b.num_guests) {
          descriptionLines.push(`Huespedes: ${b.num_guests}`);
        }
        if (b.note) {
          descriptionLines.push(`Notas: ${b.note}`);
        }

        return [
          "BEGIN:VEVENT",
          `DTSTAMP:${now}`,
          `DTSTART;VALUE=DATE:${toIcalDate(b.check_in)}`,
          `DTEND;VALUE=DATE:${toIcalDate(b.check_out)}`,
          `SUMMARY:${summary}`,
          `DESCRIPTION:${descriptionLines.join("\\n")}`,
          `UID:stayhost-booking-${b.source_uid || b.id}@stayhost.app`,
          "END:VEVENT",
        ].join("\r\n");
      })
      .join("\r\n");
  }

  // Si no hay events no incluimos linea vacia — RFC5545 no permite blank
  // lines dentro de VCALENDAR y Airbnb rechaza el feed con esa estructura.
  const calLines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//StayHost//Hosting Calendar 1.0//EN",
    "CALSCALE:GREGORIAN",
    "VERSION:2.0",
    `X-WR-CALNAME:${calName}`,
    "X-WR-TIMEZONE:UTC",
  ];
  if (events) calLines.push(events);
  calLines.push("END:VCALENDAR");
  const cal = calLines.join("\r\n");

  return new NextResponse(cal, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="stayhost-${type}-${propertyId}.ics"`,
      "Cache-Control": "no-cache, no-store",
    },
  });
}
