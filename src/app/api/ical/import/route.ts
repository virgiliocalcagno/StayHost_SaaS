import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { syncIcalForProperty } from "@/lib/ical/sync-property";

// POST /api/ical/import
// Body: { propertyId: string }
// Tenant resuelto desde la sesion. RLS garantiza que la propiedad pertenece
// al tenant del caller — ademas validamos abajo para devolver 404 en lugar
// de un error de permisos confuso.
//
// La logica completa vive en src/lib/ical/sync-property.ts para que el cron
// (sin sesion, con supabaseAdmin) tambien pueda usarla.
export async function POST(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  let propertyId: string;
  try {
    const body = await req.json();
    propertyId = body.propertyId;
    if (!propertyId) {
      return NextResponse.json({ error: "propertyId required" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await syncIcalForProperty({ supabase, propertyId, tenantId });
    return NextResponse.json({
      ...result,
      total: result.imported + result.blocksImported,
    });
  } catch (err) {
    console.error("[ical/import]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
