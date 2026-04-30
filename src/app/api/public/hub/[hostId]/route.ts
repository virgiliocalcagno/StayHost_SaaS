/**
 * /api/public/hub/[hostId] — endpoint público (sin auth) para el hub de
 * reservas que comparten los hosts con sus huéspedes.
 *
 * El hostId hoy es el tenantId (UUID). A futuro, cuando agreguemos
 * tenants.slug, este endpoint debería resolver slug → tenantId primero.
 *
 * Devuelve solo lo necesario para renderizar el hub público:
 *   - hub name (derivado del tenant.company / tenant.name)
 *   - properties activas (sin info sensible: precio, fotos, descripción)
 *
 * Usa supabaseAdmin porque la página es pública. Filtra explícitamente
 * por tenant_id en cada query — no hay sesión que use RLS.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ hostId: string }> }
) {
  const { hostId } = await params;
  if (!hostId) {
    return NextResponse.json({ error: "hostId required" }, { status: 400 });
  }

  // Validar tenant existe.
  const { data: tenant, error: tenantErr } = await supabaseAdmin
    .from("tenants")
    .select("id, name, company, contact_email, owner_whatsapp, hub_welcome_message, logo_url, email")
    .eq("id", hostId)
    .maybeSingle();

  if (tenantErr || !tenant) {
    return NextResponse.json({ error: "Hub not found" }, { status: 404 });
  }

  const tenantRow = tenant as {
    id: string;
    name: string | null;
    company: string | null;
    contact_email: string | null;
    owner_whatsapp: string | null;
    hub_welcome_message: string | null;
    logo_url: string | null;
    email: string;
  };

  // Properties activas del tenant. Filtramos prop_status != 'inactive' y
  // direct_enabled != false para que el host pueda excluir propiedades del
  // hub público sin tener que borrarlas.
  const { data: props, error: propsErr } = await supabaseAdmin
    .from("properties")
    .select(`
      id, name, address, city, neighborhood, cover_image,
      price, currency, beds, baths, max_guests,
      description_es, description_en, photo_tour, amenities,
      prop_status, direct_enabled
    `)
    .eq("tenant_id", hostId);

  if (propsErr) {
    return NextResponse.json({ error: propsErr.message }, { status: 500 });
  }

  type PropRow = {
    id: string; name: string;
    address: string | null; city: string | null; neighborhood: string | null;
    cover_image: string | null;
    price: number | null; currency: string | null;
    beds: number | null; baths: number | null; max_guests: number | null;
    description_es: string | null; description_en: string | null;
    photo_tour: unknown; amenities: unknown;
    prop_status: string | null; direct_enabled: boolean | null;
  };

  const properties = ((props as PropRow[] | null) ?? [])
    .filter((p) => p.prop_status !== "inactive" && p.direct_enabled !== false)
    .map((p) => ({
      id: p.id,
      name: p.name,
      city: p.city ?? p.address ?? "",
      address: p.address ?? "",
      neighborhood: p.neighborhood ?? "",
      image: p.cover_image ?? "",
      price: Number(p.price ?? 0),
      currency: p.currency ?? "USD",
      beds: p.beds ?? null,
      baths: p.baths ?? null,
      maxGuests: p.max_guests ?? null,
      descriptionES: p.description_es ?? "",
      descriptionEN: p.description_en ?? "",
      photoTour: Array.isArray(p.photo_tour) ? p.photo_tour : [],
      amenities: Array.isArray(p.amenities) ? p.amenities : [],
    }));

  return NextResponse.json({
    hub: {
      name: tenantRow.company || tenantRow.name || "Reservas Directas",
      welcomeMessage: tenantRow.hub_welcome_message ?? null,
      logo: tenantRow.logo_url ?? null,
      contactEmail: tenantRow.contact_email ?? tenantRow.email,
      whatsapp: tenantRow.owner_whatsapp ?? null,
    },
    properties,
    // Upsells/experiencias: pendiente Sprint 3.1 (tabla upsells todavía
    // no existe). Devolvemos array vacío hasta entonces.
    experiences: [],
  });
}
