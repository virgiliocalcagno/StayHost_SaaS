import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

// Unfold RFC-5545 line continuations before parsing
function unfold(text: string) {
  return text.replace(/\r?\n[ \t]/g, "");
}

function parseIcal(text: string) {
  const unfolded = unfold(text);
  const events: {
    uid: string;
    summary: string;
    dtstart: string;
    dtend: string;
    phone: string | null;
    phone4: string | null;
    bookingUrl: string | null;
  }[] = [];

  const blocks = unfolded.split("BEGIN:VEVENT");
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
    const description = get("DESCRIPTION");
    const urlField = get("URL");

    if (!uid || !rawStart || !rawEnd) continue;

    const toDate = (raw: string) => {
      const d = raw.replace(/T.*$/, "");
      return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    };

    // Extract phone number from DESCRIPTION
    const phoneMatch = description.match(/(?:\+?[\d][\d\s\-().]{6,}[\d])/);
    const phoneDigits = phoneMatch?.[0]?.replace(/\D/g, "") ?? "";
    const phone = phoneDigits.length >= 4 ? (phoneMatch?.[0]?.trim() ?? null) : null;
    const phone4 = phoneDigits.length >= 4 ? phoneDigits.slice(-4) : null;

    // Extract booking URL — prefer URL field, fallback to https in DESCRIPTION
    const urlInDesc = description.match(/https?:\/\/[^\s\\]+/)?.[0] ?? null;
    const bookingUrl = urlField || urlInDesc || null;

    events.push({ uid, summary, dtstart: toDate(rawStart), dtend: toDate(rawEnd), phone, phone4, bookingUrl });
  }
  return events;
}

function detectChannel(url: string): "airbnb" | "vrbo" | "booking" | "manual" {
  if (url.includes("airbnb")) return "airbnb";
  if (url.includes("vrbo") || url.includes("homeaway")) return "vrbo";
  if (url.includes("booking.com")) return "booking";
  return "manual";
}

function extractGuestName(summary: string): string {
  const clean = summary.replace(/[-–]\s*(airbnb|vrbo|booking\.com).*/i, "").trim();
  if (!clean || /^(reserved|closed|blocked|airbnb)/i.test(clean)) return "Reserva Confirmada";
  return clean.split(/\s+/)[0] ?? "Huésped";
}

// POST /api/ical/import
// Body: { propertyId: string; tenantId: string }
export async function POST(req: NextRequest) {
  try {
    const { propertyId, tenantId } = await req.json();
    if (!propertyId || !tenantId) {
      return NextResponse.json({ error: "propertyId and tenantId required" }, { status: 400 });
    }

    const { data: property, error: propErr } = await supabaseAdmin
      .from("properties")
      .select("id, ical_airbnb, ical_vrbo")
      .eq("id", propertyId)
      .eq("tenant_id", tenantId)
      .single();

    if (propErr || !property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const prop = property as any;
    const feeds: { url: string; source: "airbnb" | "vrbo" | "booking" | "manual" }[] = [];
    if (prop.ical_airbnb) feeds.push({ url: prop.ical_airbnb, source: "airbnb" });
    if (prop.ical_vrbo) feeds.push({ url: prop.ical_vrbo, source: "vrbo" });

    if (feeds.length === 0) {
      return NextResponse.json({ imported: 0, message: "No iCal URLs configured" });
    }

    let imported = 0;
    let skipped = 0;

    for (const feed of feeds) {
      let icalText: string;
      try {
        const res = await fetch(feed.url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; StayHost/1.0; +https://stayhost.app)" },
          signal: AbortSignal.timeout(15_000),
        });
        console.log(`[ical/import] fetch ${feed.url} → status ${res.status}`);
        if (!res.ok) {
          console.error(`[ical/import] non-ok status ${res.status} for ${feed.url}`);
          continue;
        }
        icalText = await res.text();
        console.log(`[ical/import] got ${icalText.length} bytes`);
      } catch (fetchErr) {
        console.error(`[ical/import] fetch failed for ${feed.url}:`, fetchErr);
        continue;
      }

      const events = parseIcal(icalText);
      const channel = detectChannel(feed.url);

      for (const ev of events) {
        if (/^(blocked|not available|airbnb)/i.test(ev.summary)) {
          skipped++;
          continue;
        }

        const { error } = await supabaseAdmin.from("bookings").upsert(
          {
            property_id: propertyId,
            tenant_id: tenantId,
            source_uid: ev.uid,
            source: channel,
            guest_name: extractGuestName(ev.summary),
            guest_email: null,
            guest_phone: ev.phone,
            check_in: ev.dtstart,
            check_out: ev.dtend,
            status: "confirmed",
            booking_url: ev.bookingUrl,
          } as any,
          { onConflict: "property_id,source_uid", ignoreDuplicates: false }
        );

        if (!error) imported++;
        else console.error("[ical/import] upsert error:", error);
      }
    }

    return NextResponse.json({ imported, skipped, total: imported + skipped });
  } catch (err) {
    console.error("[ical/import]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
