/**
 * /api/settings — datos del propio tenant para el panel de Configuración.
 *
 * GET  → devuelve los campos editables del tenant del usuario autenticado.
 * PATCH → actualiza name / company / contact_email / owner_whatsapp /
 *         hub_welcome_message / logo_url. RLS garantiza que solo se actualice
 *         el tenant del usuario logueado (la query usa la sesión, no service
 *         role).
 *
 * Por qué un endpoint dedicado en vez de extender /api/me:
 *   - /api/me es read-only y se llama mucho (header, sidebar, modules) —
 *     mantenerla simple importa.
 *   - Los campos editables son específicos del Settings; mejor un endpoint
 *     que sirva ese caso y que sea fácil de auditar.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

export async function GET() {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user || !tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("tenants")
    .select(
      "id, email, name, company, contact_email, owner_whatsapp, hub_welcome_message, logo_url, plan, plan_expires_at"
    )
    .eq("id", tenantId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Not found" }, { status: 404 });
  }

  const t = data as {
    id: string;
    email: string;
    name: string | null;
    company: string | null;
    contact_email: string | null;
    owner_whatsapp: string | null;
    hub_welcome_message: string | null;
    logo_url: string | null;
    plan: string | null;
    plan_expires_at: string | null;
  };

  return NextResponse.json({
    id: t.id,
    email: t.email,
    name: t.name,
    company: t.company,
    contactEmail: t.contact_email,
    ownerWhatsapp: t.owner_whatsapp,
    hubWelcomeMessage: t.hub_welcome_message,
    logoUrl: t.logo_url,
    plan: t.plan,
    planExpiresAt: t.plan_expires_at,
  });
}

const E164 = /^\+[1-9]\d{6,14}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function PATCH(req: NextRequest) {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!user || !tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const v = body.name.trim();
    if (!v) return NextResponse.json({ error: "Nombre no puede estar vacío" }, { status: 400 });
    if (v.length > 100) return NextResponse.json({ error: "Nombre demasiado largo" }, { status: 400 });
    patch.name = v;
  }

  if ("company" in body) {
    const v = body.company == null ? null : String(body.company).trim();
    if (v && v.length > 120) return NextResponse.json({ error: "Empresa demasiado largo" }, { status: 400 });
    patch.company = v || null;
  }

  if ("contactEmail" in body) {
    const v = body.contactEmail == null ? null : String(body.contactEmail).trim().toLowerCase();
    if (v && !EMAIL.test(v)) return NextResponse.json({ error: "Email de contacto inválido" }, { status: 400 });
    patch.contact_email = v || null;
  }

  if ("ownerWhatsapp" in body) {
    const v = body.ownerWhatsapp == null ? null : String(body.ownerWhatsapp).trim();
    if (v && !E164.test(v)) {
      return NextResponse.json(
        { error: "WhatsApp debe estar en formato internacional, ej +18091234567" },
        { status: 400 }
      );
    }
    patch.owner_whatsapp = v || null;
  }

  if ("hubWelcomeMessage" in body) {
    const v = body.hubWelcomeMessage == null ? null : String(body.hubWelcomeMessage).trim();
    if (v && v.length > 500) {
      return NextResponse.json({ error: "Mensaje de bienvenida muy largo (máx 500)" }, { status: 400 });
    }
    patch.hub_welcome_message = v || null;
  }

  if ("logoUrl" in body) {
    const v = body.logoUrl == null ? null : String(body.logoUrl).trim();
    if (v && !/^https?:\/\//.test(v)) {
      return NextResponse.json({ error: "Logo debe ser una URL https" }, { status: 400 });
    }
    if (v && v.length > 500) {
      return NextResponse.json({ error: "URL de logo demasiado larga" }, { status: 400 });
    }
    patch.logo_url = v || null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
  }

  const { error } = await supabase
    .from("tenants")
    .update(patch as never)
    .eq("id", tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
