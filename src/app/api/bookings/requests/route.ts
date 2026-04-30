/**
 * GET /api/bookings/requests
 *
 * Lista las solicitudes del Hub (status='pending_review', source='hub') del
 * tenant autenticado. Las solicitudes son creadas por huéspedes desde el Hub
 * público y esperan aprobación o rechazo del host.
 *
 * Devuelve datos enriquecidos:
 *   - Datos del booking (fechas, n° huéspedes, nota)
 *   - Datos del huésped (nombre, teléfono, doc, nacionalidad)
 *   - URL firmada (60 min) de la foto del documento — el host puede
 *     verificar identidad antes de aprobar.
 *   - Nombre de la propiedad para no obligar a la UI a otro fetch.
 */
import { NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS scopea por tenant. El índice parcial bookings_pending_review_idx
  // (creado en la migración) hace este query barato.
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "id, property_id, check_in, check_out, guest_name, guest_phone, guest_doc, guest_nationality, guest_doc_photo_path, num_guests, note, created_at, phone_last4"
    )
    .eq("status", "pending_review")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Array<{
    id: string;
    property_id: string;
    check_in: string;
    check_out: string;
    guest_name: string | null;
    guest_phone: string | null;
    guest_doc: string | null;
    guest_nationality: string | null;
    guest_doc_photo_path: string | null;
    num_guests: number | null;
    note: string | null;
    created_at: string;
    phone_last4: string | null;
  }>;

  if (rows.length === 0) {
    return NextResponse.json({ requests: [] });
  }

  // Resolver nombres + precio + cleaning fee de propiedades en un solo
  // query. Esto permite al panel precalcular el total sugerido
  // (noches × precio + fee de limpieza) sin que el host tenga que
  // tipear el precio a mano.
  const propIds = Array.from(new Set(rows.map((r) => r.property_id)));
  const { data: propData } = await supabase
    .from("properties")
    .select("id, name, price, currency, cleaning_fee_one_day, cleaning_fee_more_days")
    .in("id", propIds);
  const propMap = new Map<
    string,
    { name: string; price: number; currency: string; feeOneDay: number; feeMoreDays: number }
  >();
  for (const p of (propData ?? []) as Array<{
    id: string;
    name: string;
    price: number | null;
    currency: string | null;
    cleaning_fee_one_day: number | null;
    cleaning_fee_more_days: number | null;
  }>) {
    propMap.set(p.id, {
      name: p.name,
      price: Number(p.price ?? 0),
      currency: p.currency ?? "USD",
      feeOneDay: Number(p.cleaning_fee_one_day ?? 0),
      feeMoreDays: Number(p.cleaning_fee_more_days ?? 0),
    });
  }

  // Signed URLs para las fotos. Usamos admin porque el bucket checkin-ids
  // tiene policies estrictas; el host autenticado tiene derecho a verlas
  // (ya validamos su tenant arriba). 60 min es suficiente para revisar.
  const result = await Promise.all(
    rows.map(async (r) => {
      let docPhotoUrl: string | null = null;
      if (r.guest_doc_photo_path) {
        const { data: signed } = await supabaseAdmin.storage
          .from("checkin-ids")
          .createSignedUrl(r.guest_doc_photo_path, 60 * 60);
        docPhotoUrl = signed?.signedUrl ?? null;
      }
      const prop = propMap.get(r.property_id);
      // Sugerencia de precio: noches × precio/noche + fee de limpieza.
      // El fee depende de la cantidad de noches (igual que el Hub público).
      const nights = Math.max(
        1,
        Math.round(
          (new Date(r.check_out).getTime() - new Date(r.check_in).getTime()) / 86400000
        )
      );
      const fee = nights === 1 ? (prop?.feeOneDay ?? 0) : (prop?.feeMoreDays ?? 0);
      const suggestedPrice = prop ? prop.price * nights + fee : 0;

      return {
        id: r.id,
        propertyId: r.property_id,
        propertyName: prop?.name ?? "(propiedad desconocida)",
        propertyPrice: prop?.price ?? 0,
        propertyCurrency: prop?.currency ?? "USD",
        cleaningFee: fee,
        suggestedPrice,
        nights,
        checkIn: r.check_in,
        checkOut: r.check_out,
        guestName: r.guest_name,
        guestPhone: r.guest_phone,
        guestDoc: r.guest_doc,
        guestNationality: r.guest_nationality,
        docPhotoUrl,
        numGuests: r.num_guests,
        note: r.note,
        createdAt: r.created_at,
        phoneLast4: r.phone_last4,
      };
    })
  );

  return NextResponse.json({ requests: result });
}
