import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { cascadeCancelBooking } from "@/lib/bookings/cleanup";

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

    // Extract booking URL from "Reservation URL: https://..." in DESCRIPTION.
    // iCal TEXT values can embed literal \n sequences (RFC-5545 escape for
    // newline) and commas as delimiters. Airbnb often dumps the URL
    // immediately followed by "\nPhone Number..." — we must stop at any of
    // those. We also post-process Airbnb reservation URLs to truncate at the
    // reservation code (10+ alphanumeric chars) to strip any residual garbage
    // like "/nPhone..." that can appear when the client collapses the escape.
    let urlInDesc = description.match(/https?:\/\/[^\s\\,<>"]+/)?.[0] ?? null;
    if (urlInDesc) {
      const airbnbMatch = urlInDesc.match(
        /^(https?:\/\/[a-z.]*airbnb\.[a-z.]+\/[^?#]*\/details\/[A-Z0-9]{6,})/i
      );
      if (airbnbMatch) urlInDesc = airbnbMatch[1];
    }
    const rawUrl = urlField || urlInDesc || null;
    // Final guard: drop anything after a literal "\n" or "/n" + capital, which
    // Airbnb uses to start the Phone Number line.
    const bookingUrl = rawUrl
      ? rawUrl.replace(/(\\n|\/n[A-Z]).*$/, "")
      : null;

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
// Body: { propertyId: string }
// Tenant is resolved from the session — the caller no longer passes tenantId.
// RLS guarantees the property must belong to the caller's tenant.
export async function POST(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  try {
    const { propertyId } = await req.json();
    if (!propertyId) {
      return NextResponse.json({ error: "propertyId required" }, { status: 400 });
    }

    const { data: property, error: propErr } = await supabase
      .from("properties")
      .select("id, ical_airbnb, ical_vrbo")
      .eq("id", propertyId)
      .single();

    if (propErr || !property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const prop = property as {
      id: string;
      ical_airbnb: string | null;
      ical_vrbo: string | null;
    };
    const feeds: { url: string; source: "airbnb" | "vrbo" | "booking" | "manual" }[] = [];
    if (prop.ical_airbnb) feeds.push({ url: prop.ical_airbnb, source: "airbnb" });
    if (prop.ical_vrbo) feeds.push({ url: prop.ical_vrbo, source: "vrbo" });

    if (feeds.length === 0) {
      return NextResponse.json({ imported: 0, message: "No iCal URLs configured" });
    }

    let imported = 0;
    let blocksImported = 0;
    const skipped = 0;
    let orphansCancelled = 0;
    const errors: { feed: string; uid?: string; message: string }[] = [];

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
          errors.push({ feed: feed.source, message: `Feed devolvió status ${res.status}` });
          continue;
        }
        icalText = await res.text();
        console.log(`[ical/import] got ${icalText.length} bytes`);
      } catch (fetchErr) {
        console.error(`[ical/import] fetch failed for ${feed.url}:`, fetchErr);
        errors.push({
          feed: feed.source,
          message: `No se pudo descargar el feed: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
        });
        continue;
      }

      const events = parseIcal(icalText);
      const channel = detectChannel(feed.url);

      // Detección de orphans: bookings que estaban en la BD para este feed
      // (source = channel) pero NO aparecen en el iCal actual → el huésped
      // canceló en Airbnb/VRBO. Marcamos cancelled + cascade cleanup.
      // Recolectamos los UIDs vistos durante la importación y al final
      // comparamos.
      const seenUids = new Set<string>();

      for (const ev of events) {
        // "Airbnb (Not available)", "Blocked", "Not available" = manual blocks from platform
        const isBlock = /not available|blocked/i.test(ev.summary);

        // Código de reserva del canal (para login del huésped en /checkin).
        // Airbnb: HMXXXXXXXX dentro de la URL del DESCRIPTION.
        // VRBO/Booking: por ahora null (añadir parser cuando tengamos muestras).
        const channelCode = (() => {
          if (isBlock || !ev.bookingUrl) return null;
          const airbnbMatch = ev.bookingUrl.match(/details\/([A-Z0-9]{8,})/i);
          if (airbnbMatch) return airbnbMatch[1].toUpperCase();
          return null;
        })();

        const baseRow: Record<string, unknown> = {
          property_id: propertyId,
          tenant_id: tenantId,
          source_uid: ev.uid,
          source: isBlock ? "block" : channel,
          guest_name: isBlock ? "Bloqueado" : extractGuestName(ev.summary),
          guest_email: null,
          guest_phone: isBlock ? null : ev.phone,
          phone_last4: isBlock ? null : ev.phone4,
          channel_code: channelCode,
          check_in: ev.dtstart,
          check_out: ev.dtend,
          status: isBlock ? "blocked" : "confirmed",
          booking_url: isBlock ? null : ev.bookingUrl,
        };

        // Fallback acumulativo: si una migración pendiente falta, drop la
        // columna y reintentamos. Acumulamos las dropeadas para que un segundo
        // error en otra columna no resucite la primera.
        const droppedCols = new Set<string>();
        const tryUpsert = async () => {
          const row = { ...baseRow };
          droppedCols.forEach((c) => { delete row[c]; });
          const { error: upErr } = await supabase
            .from("bookings")
            .upsert(row as never, {
              onConflict: "property_id,source_uid",
              ignoreDuplicates: false,
            });
          return upErr;
        };

        let error = await tryUpsert();
        const candidateCols = ["booking_url", "channel_code", "phone_last4"];
        let attempts = 0;
        while (error && attempts < candidateCols.length) {
          const missing = candidateCols.find(
            (c) => !droppedCols.has(c) && error?.message?.includes(c)
          );
          if (!missing) break;
          droppedCols.add(missing);
          error = await tryUpsert();
          attempts++;
        }

        if (!error) {
          if (isBlock) blocksImported++;
          else imported++;
        } else {
          console.error("[ical/import] upsert error:", error.message, "row:", baseRow);
          errors.push({
            feed: feed.source,
            uid: ev.uid,
            message: error.message,
          });
        }

        // Registramos el UID como "visto" solo si el upsert no fallo.
        if (!error && !isBlock) seenUids.add(ev.uid);
      }

      // Detectar orphans — bookings del canal que ya no están en el feed.
      // Solo miramos reservas confirmadas (ignoramos bloques y canceladas).
      try {
        const { data: existing } = await supabase
          .from("bookings")
          .select("id, source_uid")
          .eq("property_id", propertyId)
          .eq("source", channel)
          .eq("status", "confirmed");

        const toCancel = ((existing ?? []) as Array<{ id: string; source_uid: string | null }>)
          .filter((b) => b.source_uid && !seenUids.has(b.source_uid));

        for (const orphan of toCancel) {
          const { error: updErr } = await supabase
            .from("bookings")
            .update({ status: "cancelled" } as never)
            .eq("id", orphan.id);
          if (updErr) {
            console.error("[ical/import] orphan cancel error:", updErr.message);
            continue;
          }
          // Cascade cleanup — borra check-in records + access_pins
          await cascadeCancelBooking(orphan.id);
          orphansCancelled++;
        }
      } catch (orphanErr) {
        console.error("[ical/import] orphan detection failed:", orphanErr);
      }
    }

    return NextResponse.json({
      imported,
      blocksImported,
      skipped,
      orphansCancelled,
      total: imported + blocksImported + skipped,
      errors,
    });
  } catch (err) {
    console.error("[ical/import]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
