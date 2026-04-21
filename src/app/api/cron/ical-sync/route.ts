/**
 * Cron — sync iCal automatico para todas las propiedades.
 *
 * Vercel Cron lo invoca cada 30 min con `Authorization: Bearer <CRON_SECRET>`.
 * Recorre todas las propiedades que tienen `ical_airbnb` o `ical_vrbo`
 * configurado y dispara el sync. Sin esto, las reservas nuevas en
 * Airbnb/VRBO solo se importan cuando el host abre el dashboard y guarda
 * la propiedad — peligroso si entra una reserva de noche.
 *
 * Limites de tiempo:
 *   - Vercel Hobby: 10s por funcion (no alcanza con muchas propiedades)
 *   - Vercel Pro: 60s default, hasta 300s con maxDuration
 *
 * Si el tenant tiene >50 propiedades habria que paralelizar en chunks.
 * Por ahora secuencial — el orden ayuda a no saturar Airbnb con requests
 * en paralelo (rate limit informal del feed).
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { syncIcalForProperty } from "@/lib/ical/sync-property";

// Margen amplio: 50 propiedades * (3-4s por feed * 2 feeds) ~= 400s.
// Vercel Pro maximo 300, ajustar si fuera necesario.
export const maxDuration = 300;

type PropertyRow = {
  id: string;
  tenant_id: string;
  name: string | null;
  ical_airbnb: string | null;
  ical_vrbo: string | null;
};

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabaseAdmin.from("properties") as any)
    .select("id, tenant_id, name, ical_airbnb, ical_vrbo")
    .or("ical_airbnb.not.is.null,ical_vrbo.not.is.null");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const properties = (data ?? []) as PropertyRow[];
  const startedAt = Date.now();

  type PropertyResult = {
    propertyId: string;
    name: string | null;
    imported: number;
    blocksImported: number;
    orphansCancelled: number;
    errors: number;
    durationMs: number;
  };

  const results: PropertyResult[] = [];
  let totals = { imported: 0, blocksImported: 0, orphansCancelled: 0, errors: 0 };

  for (const prop of properties) {
    const t0 = Date.now();
    try {
      const r = await syncIcalForProperty({
        supabase: supabaseAdmin,
        propertyId: prop.id,
        tenantId: prop.tenant_id,
      });
      results.push({
        propertyId: prop.id,
        name: prop.name,
        imported: r.imported,
        blocksImported: r.blocksImported,
        orphansCancelled: r.orphansCancelled,
        errors: r.errors.length,
        durationMs: Date.now() - t0,
      });
      totals.imported += r.imported;
      totals.blocksImported += r.blocksImported;
      totals.orphansCancelled += r.orphansCancelled;
      totals.errors += r.errors.length;
      if (r.errors.length > 0) {
        console.error(`[cron/ical-sync] errors in property ${prop.id}:`, r.errors);
      }
    } catch (err) {
      console.error(`[cron/ical-sync] property ${prop.id} threw:`, err);
      results.push({
        propertyId: prop.id,
        name: prop.name,
        imported: 0,
        blocksImported: 0,
        orphansCancelled: 0,
        errors: 1,
        durationMs: Date.now() - t0,
      });
      totals.errors++;
    }
  }

  return NextResponse.json({
    scope: "cron",
    propertiesChecked: properties.length,
    totals,
    results,
    totalDurationMs: Date.now() - startedAt,
  });
}
