import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

// Minimal iCal parser — no external dependency needed
function parseIcal(text: string) {
  const events: {
    uid: string;
    summary: string;
    dtstart: string;
    dtend: string;
  }[] = [];

  const blocks = text.split("BEGIN:VEVENT");
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const get = (key: string) => {
      const match = block.match(new RegExp(`${key}(?:;[^:]*)?:([^\r\n]+)`));
      return match?.[1]?.trim() ?? "";
    };
    const uid = get("UID");
    const summary = get("SUMMARY");
    const rawStart = get("DTSTART");
    const rawEnd = get("DTEND");
    if (!uid || !rawStart || !rawEnd) continue;

    // Convert YYYYMMDD or YYYYMMDDTHHmmssZ to ISO date
    const toDate = (raw: string) => {
      const d = raw.replace(/T.*$/, "");
      return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    };

    events.push({ uid, summary, dtstart: toDate(rawStart), dtend: toDate(rawEnd) });
  }
  return events;
}

function detectChannel(url: string): "airbnb" | "vrbo" | "booking" | "manual" {
  if (url.includes("airbnb")) return "airbnb";
  if (url.includes("vrbo") || url.includes("homeaway")) return "vrbo";
  if (url.includes("booking.com")) return "booking";
  return "manual";
}

function extractGuestName(summary: string): { first: string; last: string } {
  // Airbnb: "Reserved", "John D." / VRBO: "John Doe - vrbo" / Booking: "CLOSED"
  const clean = summary.replace(/[-–]\s*(airbnb|vrbo|booking\.com).*/i, "").trim();
  if (!clean || /^(reserved|closed|blocked|airbnb)/i.test(clean)) {
    return { first: "Reserva", last: "Confirmada" };
  }
  const parts = clean.split(/\s+/);
  return { first: parts[0] ?? "Huésped", last: parts.slice(1).join(" ") || "" };
}

// POST /api/ical/import
// Body: { propertyId: string; tenantId: string }
export async function POST(req: NextRequest) {
  try {
    const { propertyId, tenantId } = await req.json();
    if (!propertyId || !tenantId) {
      return NextResponse.json({ error: "propertyId and tenantId required" }, { status: 400 });
    }

    // Load property iCal URLs
    const { data: property, error: propErr } = await supabaseAdmin
      .from("properties")
      .select("id, ical_airbnb, ical_vrbo")
      .eq("id", propertyId)
      .eq("tenant_id", tenantId)
      .single();

    if (propErr || !property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const feeds: { url: string; source: "airbnb" | "vrbo" | "booking" | "manual" }[] = [];
    if (property.ical_airbnb) feeds.push({ url: property.ical_airbnb, source: "airbnb" });
    if (property.ical_vrbo) feeds.push({ url: property.ical_vrbo, source: "vrbo" });

    if (feeds.length === 0) {
      return NextResponse.json({ imported: 0, message: "No iCal URLs configured" });
    }

    let imported = 0;
    let skipped = 0;

    for (const feed of feeds) {
      let icalText: string;
      try {
        const res = await fetch(feed.url, {
          headers: { "User-Agent": "StayHost/1.0 iCal Sync" },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) continue;
        icalText = await res.text();
      } catch {
        continue;
      }

      const events = parseIcal(icalText);
      const channel = detectChannel(feed.url);

      for (const ev of events) {
        // Skip blocked/unavailable slots (no real guest)
        if (/^(blocked|not available|airbnb)/i.test(ev.summary)) {
          skipped++;
          continue;
        }

        const { first, last } = extractGuestName(ev.summary);

        // Upsert by (property_id, source_uid) — safe to re-run
        const { error } = await supabaseAdmin.from("bookings").upsert(
          {
            property_id: propertyId,
            tenant_id: tenantId,
            source_uid: ev.uid,
            source: channel,
            guest_name: first,
            guest_email: null,
            guest_phone: null,
            check_in: ev.dtstart,
            check_out: ev.dtend,
            status: "confirmed",
          },
          { onConflict: "property_id,source_uid", ignoreDuplicates: false }
        );

        if (!error) imported++;
      }
    }

    return NextResponse.json({ imported, skipped, total: imported + skipped });
  } catch (err) {
    console.error("[ical/import]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
