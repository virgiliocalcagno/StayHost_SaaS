import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

// GET /api/ical/[propertyId]?token=<ical_token>
// Returns an .ics file with all bookings for the property.
// Airbnb/VRBO subscribe to this URL to block days automatically.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> }
) {
  const { propertyId } = await params;
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Validate token belongs to this property
  const { data: property, error: propErr } = await supabaseAdmin
    .from("properties")
    .select("id, name, ical_token, tenant_id")
    .eq("id", propertyId)
    .eq("ical_token", token)
    .single();

  if (propErr || !property) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const prop = property as any;

  // Fetch all confirmed bookings + manual blocks
  const { data: bookings, error: bookErr } = await supabaseAdmin
    .from("bookings")
    .select("id, guest_name, check_in, check_out, source, status")
    .eq("property_id", propertyId)
    .neq("status", "cancelled");

  if (bookErr) {
    return new NextResponse("Internal error", { status: 500 });
  }

  const now = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 15) + "Z";
  const toIcalDate = (d: string) => d.replace(/-/g, "");

  const events = ((bookings ?? []) as any[]).map((b) => {
    const uid = `stayhost-${b.id}@stayhost.app`;
    const summary = b.source === "block" ? "Not available" : "Reserved";
    return [
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${toIcalDate(b.check_in)}`,
      `DTEND;VALUE=DATE:${toIcalDate(b.check_out)}`,
      `SUMMARY:${summary}`,
      `STATUS:CONFIRMED`,
      "END:VEVENT",
    ].join("\r\n");
  });

  const ical = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//StayHost//Calendar//ES",
    `X-WR-CALNAME:${prop.name}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");

  return new NextResponse(ical, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${propertyId}.ics"`,
      "Cache-Control": "no-cache, no-store",
    },
  });
}
