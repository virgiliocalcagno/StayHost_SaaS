/**
 * GET /api/upsell-templates
 *
 * Lista templates curados disponibles para clonar. Auth obligatorio
 * (cualquier authenticated del SaaS los ve). RLS habilita SELECT a todos.
 *
 * Query opcional:
 *   ?market=punta-cana (default)
 *   ?category=excursion|transport|...
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";

type Row = {
  id: string;
  name: string;
  description: string | null;
  name_en: string | null;
  description_en: string | null;
  category: string;
  icon_name: string;
  hero_photo: string | null;
  suggested_price: string | number;
  currency: string;
  pricing_model: string;
  min_quantity: number;
  max_quantity: number | null;
  capacity_per_slot: number | null;
  cutoff_hours: number;
  market: string;
  popularity_rank: number;
  // Sprint 5: info del servicio (pre-configurado por template)
  time_field: string | null;
  pickup_field: string | null;
  flight_field: string | null;
  notes_placeholder: string | null;
};

// Allow-list para evitar que un typo de query devuelva catálogo vacío
// silenciosamente. Cuando agreguemos otros mercados (Cancún, Miami, etc.)
// se agregan acá.
const VALID_MARKETS = new Set(["punta-cana"]);
const VALID_CATEGORIES = new Set([
  "excursion","transport","food","laundry","spa","concierge",
  "rental","connectivity","service","other",
]);

export async function GET(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  const market = req.nextUrl.searchParams.get("market") || "punta-cana";
  if (!VALID_MARKETS.has(market)) {
    return NextResponse.json({ error: `market inválido: ${market}` }, { status: 400 });
  }
  const category = req.nextUrl.searchParams.get("category");
  if (category && !VALID_CATEGORIES.has(category)) {
    return NextResponse.json({ error: "category inválida" }, { status: 400 });
  }

  let q = supabase
    .from("upsell_templates")
    .select("*")
    .eq("market", market)
    .eq("active", true)
    .order("popularity_rank", { ascending: true });
  if (category) q = q.eq("category", category);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const templates = ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    nameEn: r.name_en,
    descriptionEn: r.description_en,
    category: r.category,
    iconName: r.icon_name,
    heroPhoto: r.hero_photo,
    suggestedPrice: Number(r.suggested_price),
    currency: r.currency,
    pricingModel: r.pricing_model,
    minQuantity: r.min_quantity,
    maxQuantity: r.max_quantity,
    capacityPerSlot: r.capacity_per_slot,
    cutoffHours: r.cutoff_hours,
    market: r.market,
    popularityRank: r.popularity_rank,
    timeField: r.time_field ?? "off",
    pickupField: r.pickup_field ?? "off",
    flightField: r.flight_field ?? "off",
    notesPlaceholder: r.notes_placeholder,
  }));

  return NextResponse.json({ templates });
}
