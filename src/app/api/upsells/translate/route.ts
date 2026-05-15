/**
 * POST /api/upsells/translate
 *
 * Endpoint asistencial — recibe name + description en español y devuelve
 * propuesta de traducción al inglés vía Gemini Flash-Lite.
 *
 * NO toca la BD: solo devuelve la sugerencia para que el form la inserte
 * en los inputs nameEn / descriptionEn. El host puede editar antes de
 * guardar el upsell.
 *
 * Auth: requiere sesión + rol MANAGE_ROLES. Esto es porque la llamada a
 * Gemini consume cuota del API key del SaaS — no queremos que sea pública.
 *
 * Body: { name?: string, description?: string }
 * Response: { ok: true, name: string|null, description: string|null }
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { translateUpsellToEnglish } from "@/lib/translate/gemini";

const MANAGE_ROLES = new Set(["owner", "admin", "manager", "co_host"]);

export async function POST(req: NextRequest) {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user?.id || !tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  // Role guard — sin esto un team_member de bajo privilegio (cleaner) podría
  // consumir cuota Gemini del SaaS spammeando este endpoint.
  const { data: memberRow } = await supabase
    .from("team_members")
    .select("role")
    .eq("auth_user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const member = memberRow as { role: string | null } | null;
  if (member !== null) {
    if (!member.role || !MANAGE_ROLES.has(member.role)) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
  }

  let body: { name?: string; description?: string };
  try {
    body = (await req.json()) as { name?: string; description?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.slice(0, 500) : "";
  const description = typeof body.description === "string" ? body.description.slice(0, 5000) : "";

  if (!name.trim() && !description.trim()) {
    return NextResponse.json(
      { error: "Mandá al menos name o description para traducir" },
      { status: 400 },
    );
  }

  const result = await translateUpsellToEnglish({ name, description });
  if (!result.ok) {
    console.error("[upsells/translate] Gemini failed:", result.error);
    return NextResponse.json(
      { error: "No se pudo traducir. Intentá de nuevo o escribilo manual." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    name: result.name,
    description: result.description,
  });
}
