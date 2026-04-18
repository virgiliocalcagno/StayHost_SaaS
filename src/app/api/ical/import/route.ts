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

    // Airbnb format: "Phone Number (Last 4 Digits): 0667"
    const phone4Match = description.match(/(?:Phone Number\s*\(Last 4 Digits?\)|Last 4 Digits?)\s*[:\-]\s*(\d{4})/i);
    const phone4 = phone4Match?.[1] ?? null;
    const phone = phone4 ? `****${phone4}` : null;

    // Extract booking URL from "Reservation URL: https://..." in DESCRIPTION
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
        // "Airbnb (Not available)", "Blocked", "Not available" = manual blocks from platform
        const isBlock = /not available|blocked/i.test(ev.summary);

        const baseRow: Record<string, unknown> = {
          property_id: propertyId,
          tenant_id: tenantId,
          source_uid: ev.uid,
          source: isBlock ? "block" : channel,
          guest_name: isBlock ? "Bloqueado" : extractGuestName(ev.summary),
          guest_email: null,
          guest_phone: isBlock ? null : ev.phone,
          check_in: ev.dtstart,
          check_out: ev.dtend,
          status: isBlock ? "blocked" : "confirmed",
          booking_url: isBlock ? null : ev.bookingUrl,
        };

        let { error } = await supabaseAdmin.from("bookings").upsert(
          baseRow as any, { onConflict: "property_id,source_uid", ignoreDuplicates: false }
        );

        // Fallback: if booking_url column missing, retry without it
        if (error?.message?.includes("booking_url")) {
          const { booking_url: _drop, ...rowWithout } = baseRow;
          const res2 = await supabaseAdmin.from("bookings").upsert(
            rowWithout as any, { onConflict: "property_id,source_uid", ignoreDuplicates: false }
          );
          error = res2.error;
        }

        if (!error) imported++;
        else console.error("[ical/import] upsert error:", error.message);
      }
    }

    return NextResponse.json({ imported, skipped, total: imported + skipped });
  } catch (err) {
    console.error("[ical/import]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
