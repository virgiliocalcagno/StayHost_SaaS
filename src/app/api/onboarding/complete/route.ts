/**
 * POST /api/onboarding/complete — marca el tenant como onboarded.
 *
 * Lo llama la página /onboarding al terminar el wizard. RLS impide marcar
 * de otro tenant.
 */
import { NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

export async function POST() {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant" }, { status: 403 });
  }

  const { error } = await supabase
    .from("tenants")
    .update({ onboarding_completed_at: new Date().toISOString() } as never)
    .eq("id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
