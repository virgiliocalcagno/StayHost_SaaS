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

  // Validar tenant existe. NUNCA seleccionamos `tenants.email` — es el email
  // de login del owner (cuenta Supabase Auth). El campo público es
  // `contact_email`. Antes hacíamos fallback al email de cuenta, lo que
  // exponía la cuenta del owner a cualquier huésped con la URL del Hub.
  const { data: tenant, error: tenantErr } = await supabaseAdmin
    .from("tenants")
    .select("id, name, company, contact_email, owner_whatsapp, hub_welcome_message, logo_url")
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

  // Fechas no disponibles por propiedad — solo confirmed/blocked (las
  // pending_review NO bloquean: el host puede recibir multiples solicitudes
  // para las mismas fechas y elegir). Solo miramos a futuro: bookings con
  // check_out >= today.
  const today = new Date().toISOString().slice(0, 10);
  const propIds = properties.map((p) => p.id);
  let unavailable: Array<{ propertyId: string; checkIn: string; checkOut: string; status: string }> = [];
  if (propIds.length > 0) {
    const { data: bookingRows } = await supabaseAdmin
      .from("bookings")
      .select("property_id, check_in, check_out, status")
      .in("property_id", propIds)
      .in("status", ["confirmed", "blocked"])
      .gte("check_out", today);
    unavailable = ((bookingRows ?? []) as Array<{
      property_id: string; check_in: string; check_out: string; status: string;
    }>).map((b) => ({
      propertyId: b.property_id,
      checkIn: b.check_in,
      checkOut: b.check_out,
      status: b.status,
    }));
  }

  // ¿El host tiene PayPal habilitado? Solo flag — credenciales nunca se
  // exponen al frontend. El cliente ID del PayPal SDK se pide después
  // recién en /hub/[hostId]/pay/[token] cuando el huésped va a pagar.
  const { data: paypalConfig } = await supabaseAdmin
    .from("tenant_payment_configs")
    .select("enabled, client_id, processing_fee_percent")
    .eq("tenant_id", hostId)
    .eq("provider", "paypal")
    .maybeSingle();
  const ppRow = paypalConfig as {
    enabled?: boolean; client_id?: string; processing_fee_percent?: number | string | null;
  } | null;
  const paypalEnabled = !!ppRow && !!ppRow.enabled && !!ppRow.client_id;
  // El fee solo se devuelve si PayPal está realmente habilitado — sino, no
  // hay razón para exponer un % de comisión interna al huésped.
  const processingFeePercent = paypalEnabled
    ? Number(ppRow?.processing_fee_percent ?? 0)
    : 0;

  // ── Upsells activos del tenant (Sprint 3) ────────────────────────────────
  // Sólo los `is_global` o vinculados a alguna propiedad activa van al Hub.
  // Si más adelante se pide filtrar "vinculados a esta propiedad específica
  // que el huésped ya tiene reservada", se hace en el front con la lista
  // completa, o se agrega un parámetro de query.
  const { data: upsellRows } = await supabaseAdmin
    .from("upsells")
    .select(`
      id, name, description, category, icon_name,
      price, currency, hero_photo, gallery_photos,
      pricing_model, min_quantity, max_quantity, cutoff_hours,
      is_global, linked_property_ids,
      vendor_id
    `)
    .eq("tenant_id", hostId)
    .eq("active", true)
    .order("created_at", { ascending: false });

  type UpsellRow = {
    id: string; name: string; description: string | null;
    category: string; icon_name: string;
    price: number | string; currency: string;
    hero_photo: string | null; gallery_photos: unknown;
    pricing_model: string;
    min_quantity: number; max_quantity: number | null;
    cutoff_hours: number;
    is_global: boolean; linked_property_ids: unknown;
    vendor_id: string | null;
  };

  // Vendors: cargamos solo los que están referenciados por algún upsell.
  // Exponemos al huésped SOLO display_name y hero_photo (marca pública).
  // NUNCA: phone, email, rnc, contact_name, notes, commission, payment_terms.
  const vendorIds = Array.from(
    new Set(
      ((upsellRows ?? []) as UpsellRow[])
        .map((u) => u.vendor_id)
        .filter((v): v is string => !!v),
    ),
  );
  let vendorMap = new Map<string, { name: string; photo: string | null }>();
  if (vendorIds.length > 0) {
    const { data: vendors } = await supabaseAdmin
      .from("upsell_vendors")
      .select("id, name, display_name, hero_photo")
      .in("id", vendorIds)
      .eq("tenant_id", hostId);
    vendorMap = new Map(
      ((vendors ?? []) as { id: string; name: string; display_name: string | null; hero_photo: string | null }[])
        .map((v) => [v.id, { name: v.display_name ?? v.name, photo: v.hero_photo }]),
    );
  }

  const experiences = ((upsellRows ?? []) as UpsellRow[]).map((u) => {
    const linked = Array.isArray(u.linked_property_ids) ? (u.linked_property_ids as string[]) : [];
    const gallery = Array.isArray(u.gallery_photos) ? (u.gallery_photos as string[]) : [];
    const vInfo = u.vendor_id ? vendorMap.get(u.vendor_id) ?? null : null;
    return {
      id: u.id,
      name: u.name,
      description: u.description,
      category: u.category,
      iconName: u.icon_name,
      price: Number(u.price),
      currency: u.currency || "USD",
      heroPhoto: u.hero_photo,
      galleryPhotos: gallery,
      pricingModel: u.pricing_model,
      minQuantity: u.min_quantity,
      maxQuantity: u.max_quantity,
      cutoffHours: u.cutoff_hours,
      isGlobal: u.is_global,
      linkedPropertyIds: linked,
      // Vendor: solo info de cara pública. Nada del trato comercial ni PII.
      vendor: vInfo,
    };
  });

  return NextResponse.json({
    hub: {
      name: tenantRow.company || tenantRow.name || "Reservas Directas",
      welcomeMessage: tenantRow.hub_welcome_message ?? null,
      logo: tenantRow.logo_url ?? null,
      contactEmail: tenantRow.contact_email ?? null,
      whatsapp: tenantRow.owner_whatsapp ?? null,
      paymentMethods: {
        paypal: paypalEnabled,
      },
      processingFeePercent,
    },
    properties,
    unavailable,
    experiences,
  });
}
