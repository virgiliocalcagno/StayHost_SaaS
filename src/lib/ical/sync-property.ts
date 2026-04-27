/**
 * Sync iCal feeds (Airbnb / VRBO) → bookings de una propiedad.
 *
 * Funcion pura sin dependencia de NextRequest — la usan tanto el endpoint
 * autenticado /api/ical/import (con sesion del host) como el cron
 * /api/cron/ical-sync (con supabaseAdmin y CRON_SECRET).
 *
 * Lee `properties.ical_airbnb` y `properties.ical_vrbo`, descarga cada feed,
 * upsertea bookings/bloqueos, y cancela orphans (reservas/bloqueos que
 * desaparecieron del feed) preservando bloqueos manuales.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { cascadeCancelBooking } from "@/lib/bookings/cleanup";
import { ensureCleaningTasksForProperty } from "@/lib/cleaning/ensure-tasks";
import { syncBookingDownstream } from "@/lib/bookings/sync-downstream";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>;

export type SyncResult = {
  imported: number;
  blocksImported: number;
  orphansCancelled: number;
  errors: { feed: string; uid?: string; message: string }[];
};

// ── Parser ──────────────────────────────────────────────────────────────────

function unfold(text: string) {
  return text.replace(/\r?\n[ \t]/g, "");
}

type ParsedEvent = {
  uid: string;
  summary: string;
  dtstart: string;
  dtend: string;
  phone: string | null;
  phone4: string | null;
  bookingUrl: string | null;
};

function parseIcal(text: string): ParsedEvent[] {
  const unfolded = unfold(text);
  const events: ParsedEvent[] = [];

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

    const phone4Match = description.match(/(?:Phone Number\s*\(Last 4 Digits?\)|Last 4 Digits?)\s*[:\-]\s*(\d{4})/i);
    const phone4 = phone4Match?.[1] ?? null;
    const phone = phone4 ? `****${phone4}` : null;

    let urlInDesc = description.match(/https?:\/\/[^\s\\,<>"]+/)?.[0] ?? null;
    if (urlInDesc) {
      const airbnbMatch = urlInDesc.match(
        /^(https?:\/\/[a-z.]*airbnb\.[a-z.]+\/[^?#]*\/details\/[A-Z0-9]{6,})/i
      );
      if (airbnbMatch) urlInDesc = airbnbMatch[1];
    }
    const rawUrl = urlField || urlInDesc || null;
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

// ── Sync principal ──────────────────────────────────────────────────────────

export async function syncIcalForProperty(args: {
  supabase: AnySupabase;
  propertyId: string;
  tenantId: string;
}): Promise<SyncResult> {
  const { supabase, propertyId, tenantId } = args;
  const result: SyncResult = {
    imported: 0,
    blocksImported: 0,
    orphansCancelled: 0,
    errors: [],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: property, error: propErr } = await (supabase.from("properties") as any)
    .select("id, ical_airbnb, ical_vrbo")
    .eq("id", propertyId)
    .single();

  if (propErr || !property) {
    result.errors.push({ feed: "property", message: "Property not found" });
    return result;
  }

  const prop = property as {
    id: string;
    ical_airbnb: string | null;
    ical_vrbo: string | null;
  };
  const feeds: { url: string; source: "airbnb" | "vrbo" | "booking" | "manual" }[] = [];
  if (prop.ical_airbnb) feeds.push({ url: prop.ical_airbnb, source: "airbnb" });
  if (prop.ical_vrbo) feeds.push({ url: prop.ical_vrbo, source: "vrbo" });

  if (feeds.length === 0) return result;

  for (const feed of feeds) {
    let icalText: string;
    try {
      const res = await fetch(feed.url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; StayHost/1.0; +https://stayhost.app)" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        result.errors.push({ feed: feed.source, message: `Feed devolvió status ${res.status}` });
        continue;
      }
      icalText = await res.text();
    } catch (fetchErr) {
      result.errors.push({
        feed: feed.source,
        message: `No se pudo descargar el feed: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
      });
      continue;
    }

    const events = parseIcal(icalText);
    const channel = detectChannel(feed.url);
    const seenUids = new Set<string>();

    for (const ev of events) {
      const isBlock = /not available|blocked/i.test(ev.summary);

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

      // Snapshot del estado previo del booking (si ya existia). Lo usamos
      // despues del upsert para detectar cambios de check_in/check_out/
      // guest_name y propagar a cleaning_tasks + access_pins. Sin esto, una
      // reserva Airbnb que cambia su DTEND queda con la task y el PIN en
      // las dates viejas.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existingRow } = await (supabase.from("bookings") as any)
        .select("id, check_in, check_out, guest_name")
        .eq("property_id", propertyId)
        .eq("source_uid", ev.uid)
        .maybeSingle();
      const previous = existingRow as {
        id: string;
        check_in: string;
        check_out: string;
        guest_name: string | null;
      } | null;

      // Fallback acumulativo de columnas faltantes (migraciones pendientes)
      const droppedCols = new Set<string>();
      const tryUpsert = async () => {
        const row = { ...baseRow };
        droppedCols.forEach((c) => { delete row[c]; });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: upErr } = await (supabase.from("bookings") as any)
          .upsert(row, {
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
        if (isBlock) result.blocksImported++;
        else result.imported++;
        seenUids.add(ev.uid);

        // Si el booking ya existia y algun campo crítico cambio, propagar
        // downstream: cleaning_task.due_date / guest_name + access_pins
        // valid_from/valid_to + remarcar para resync TTLock.
        if (
          previous &&
          (previous.check_in !== ev.dtstart ||
            previous.check_out !== ev.dtend ||
            previous.guest_name !== baseRow.guest_name)
        ) {
          try {
            await syncBookingDownstream(previous.id);
          } catch (downstreamErr) {
            result.errors.push({
              feed: feed.source,
              uid: ev.uid,
              message: `Downstream sync failed: ${downstreamErr instanceof Error ? downstreamErr.message : String(downstreamErr)}`,
            });
          }
        }
      } else {
        result.errors.push({
          feed: feed.source,
          uid: ev.uid,
          message: error.message,
        });
      }
    }

    // Orphan detection: reservas confirmadas o bloqueos del canal que
    // desaparecieron del feed. Preservamos bloqueos manuales (source_uid
    // empieza con "manual-").
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existing } = await (supabase.from("bookings") as any)
        .select("id, source_uid, source, status")
        .eq("property_id", propertyId)
        .neq("status", "cancelled");

      const rows = (existing ?? []) as Array<{
        id: string;
        source_uid: string | null;
        source: string;
        status: string;
      }>;

      const toCancel = rows.filter((b) => {
        if (!b.source_uid || seenUids.has(b.source_uid)) return false;
        if (b.source === channel && b.status === "confirmed") return true;
        if (
          b.source === "block" &&
          b.status === "blocked" &&
          !b.source_uid.startsWith("manual-")
        ) {
          return true;
        }
        return false;
      });

      for (const orphan of toCancel) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: updErr } = await (supabase.from("bookings") as any)
          .update({ status: "cancelled" })
          .eq("id", orphan.id);
        if (updErr) continue;
        await cascadeCancelBooking(orphan.id);
        result.orphansCancelled++;
      }
    } catch (orphanErr) {
      result.errors.push({
        feed: feed.source,
        message: `Orphan detection failed: ${orphanErr instanceof Error ? orphanErr.message : String(orphanErr)}`,
      });
    }
  }

  // Auto-schedule cleanings for all new bookings of this property. Sin este
  // paso, las reservas de Airbnb se importan pero nadie sabe que hay que
  // limpiar — la limpiadora se entera recien cuando el host abre el modulo
  // Limpiezas. Para un SaaS de hosting eso es inaceptable.
  try {
    await ensureCleaningTasksForProperty({
      supabase,
      tenantId,
      propertyId,
    });
  } catch (taskErr) {
    result.errors.push({
      feed: "cleaning-tasks",
      message: `Task scheduling failed: ${taskErr instanceof Error ? taskErr.message : String(taskErr)}`,
    });
  }

  return result;
}
