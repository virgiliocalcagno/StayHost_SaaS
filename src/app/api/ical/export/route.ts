import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

// GET /api/ical/export?id=[propertyId]
// Returns an iCal feed with all bookings + blocks for a property.
// Airbnb, VRBO, Booking.com can subscribe to this URL.
export async function GET(req: NextRequest) {
  const propertyId = req.nextUrl.searchParams.get("id");
  if (!propertyId) {
    return new NextResponse("id required", { status: 400 });
  }

  const { data: property } = await supabaseAdmin
    .from("properties")
    .select("id, name")
    .eq("id", propertyId)
    .single();

  if (!property) {
    return new NextResponse("Property not found", { status: 404 });
  }

  const { data: bookings } = await supabaseAdmin
    .from("bookings")
    .select("id, source_uid, guest_name, check_in, check_out, source, status")
    .eq("property_id", propertyId)
    .neq("status", "cancelled");

  const prop = property as any;
  const rows = (bookings ?? []) as any[];

  const toIcalDate = (iso: string) => iso.replace(/-/g, "");
  const now = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const events = rows
    .map(b => {
      const uid = b.source_uid || `${b.id}@stayhost.app`;
      const summary = b.source === "block" ? "Not available" : "Reserved";
      return [
        "BEGIN:VEVENT",
        `DTSTAMP:${now}`,
        `DTSTART;VALUE=DATE:${toIcalDate(b.check_in)}`,
        `DTEND;VALUE=DATE:${toIcalDate(b.check_out)}`,
        `SUMMARY:${summary}`,
        `UID:stayhost-${uid}`,
        "END:VEVENT",
      ].join("\r\n");
    })
    .join("\r\n");

  const cal = [
    "BEGIN:VCALENDAR",
    "PRODID:-//StayHost//Hosting Calendar 1.0//EN",
    "CALSCALE:GREGORIAN",
    "VERSION:2.0",
    `X-WR-CALNAME:StayHost - ${prop.name}`,
    "X-WR-TIMEZONE:UTC",
    events,
    "END:VCALENDAR",
  ].join("\r\n");

  return new NextResponse(cal, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="stayhost-${propertyId}.ics"`,
      "Cache-Control": "no-cache, no-store",
    },
  });
}
