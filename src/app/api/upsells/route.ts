/**
 * /api/upsells — CRUD del catálogo de Ventas Extras del host.
 *
 * Tenant resuelto desde la cookie de sesión via `getAuthenticatedTenant`.
 * RLS sobre `upsells` ya filtra cross-tenant; el chequeo `tenantId` arriba
 * es defensa en profundidad + permite devolver 403 claro si no hay sesión.
 *
 * Sprint 1: solo persiste el catálogo (lo que el host puede vender). No
 * mueve órdenes ni cobros — eso es Sprint 2+.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Upsell, UpsellCategory, PricingModel } from "@/types/upsell";
import type { VendorPricingMethod } from "@/types/upsellShared";

// 10 categorías unificadas con upsell_vendors.
const VALID_CATEGORIES = new Set<UpsellCategory>([
  "excursion",
  "transport",
  "food",
  "laundry",
  "spa",
  "concierge",
  "rental",
  "connectivity",
  "service",
  "other",
]);
const isValidCategory = (v: unknown): v is UpsellCategory =>
  typeof v === "string" && (VALID_CATEGORIES as Set<string>).has(v);

const VALID_PRICING_MODELS = new Set<PricingModel>([
  "fixed",
  "per_person",
  "per_unit",
  "per_kg",
  "per_night",
]);
const isValidPricingModel = (v: unknown): v is PricingModel =>
  typeof v === "string" && (VALID_PRICING_MODELS as Set<string>).has(v);

const VALID_VENDOR_PRICING_METHODS = new Set<VendorPricingMethod>([
  "commission",
  "fixed_cost",
  "flat_fee",
]);
const isValidVendorPricingMethod = (v: unknown): v is VendorPricingMethod =>
  typeof v === "string" && (VALID_VENDOR_PRICING_METHODS as Set<string>).has(v);

// Parser numérico nullable: null/""/undefined → null. valor inválido → undefined.
function parseNumericNullable(raw: unknown, max?: number): number | null | undefined {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  if (max !== undefined && n > max) return undefined;
  return n;
}

// Roles que pueden gestionar el catálogo de ventas extras. Staff de bajo
// privilegio (cleaner/maintenance) no debería ni ver este panel; el guard
// es defensa server-side por si llega un fetch directo conociendo la URL.
const MANAGE_ROLES = new Set(["owner", "admin", "manager", "co_host"]);

async function viewerCanManage(
  supabase: SupabaseClient,
  userId: string | undefined,
  tenantId: string,
): Promise<boolean> {
  if (!userId) return false;
  const { data } = await supabase
    .from("team_members")
    .select("role")
    .eq("auth_user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  // Sin team_member: es owner directo (no se invitó a sí mismo). OK gestiona.
  if (!data) return true;
  const row = data as { role: string | null };
  return !!row.role && MANAGE_ROLES.has(row.role);
}

// Validador cross-tenant: confirma que un vendor_id pertenece al tenant.
// Antes de Sprint 2 el Hub público va a leer estos datos — sin validación,
// un admin podría guardar vendor_id de otro tenant y leakear su nombre.
// Sprint 1.5: ahora valida contra upsell_vendors (no service_vendors), que
// es el directorio correcto para proveedores de tienda.
async function validateVendorBelongsToTenant(
  supabase: SupabaseClient,
  vendorId: string,
  tenantId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("upsell_vendors")
    .select("id")
    .eq("id", vendorId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return !!data;
}

async function validatePropertiesBelongToTenant(
  supabase: SupabaseClient,
  propertyIds: string[],
  tenantId: string,
): Promise<boolean> {
  if (propertyIds.length === 0) return true;
  const { data } = await supabase
    .from("properties")
    .select("id")
    .in("id", propertyIds)
    .eq("tenant_id", tenantId);
  const found = ((data ?? []) as { id: string }[]).map((r) => r.id);
  return propertyIds.every((id) => found.includes(id));
}

// Validador de URL de foto: debe apuntar al bucket público del tenant.
// Sin esto un caller malicioso puede meter URL arbitraria de tracking,
// malware o leakeo cross-tenant (las URLs de otros tenants son públicas
// también, por diseño del Hub).
function isOwnUpsellPhotoUrl(url: string, tenantId: string): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return false;
  const expectedPrefix = `${base}/storage/v1/object/public/upsell-photos/${tenantId}/`;
  return url.startsWith(expectedPrefix);
}

type UpsellRow = {
  id: string;
  vendor_id: string | null;
  name: string;
  description: string | null;
  category: string;
  icon_name: string;
  price: string | number;
  currency: string;
  hero_photo: string | null;
  gallery_photos: unknown;
  pricing_model: string;
  min_quantity: number;
  max_quantity: number | null;
  capacity_per_slot: number | null;
  cutoff_hours: number;
  vendor_pricing_method: string | null;
  vendor_cost: string | number | null;
  vendor_commission_percent: string | number | null;
  vendor_flat_fee: string | number | null;
  is_global: boolean;
  linked_property_ids: unknown;
  active: boolean;
  sales_count: number;
  revenue: string | number;
  created_at: string;
  updated_at: string;
};

function rowToUpsell(row: UpsellRow): Upsell {
  const linked = row.linked_property_ids;
  const linkedPropertyIds = Array.isArray(linked) ? (linked as string[]) : [];
  return {
    id: row.id,
    vendorId: row.vendor_id,
    name: row.name,
    description: row.description,
    category: (isValidCategory(row.category) ? row.category : "other"),
    iconName: row.icon_name,
    price: Number(row.price),
    currency: row.currency,
    heroPhoto: row.hero_photo,
    galleryPhotos: Array.isArray(row.gallery_photos) ? (row.gallery_photos as string[]) : [],
    pricingModel: isValidPricingModel(row.pricing_model) ? row.pricing_model : "fixed",
    minQuantity: row.min_quantity,
    maxQuantity: row.max_quantity,
    capacityPerSlot: row.capacity_per_slot,
    cutoffHours: row.cutoff_hours,
    vendorPricingMethod: isValidVendorPricingMethod(row.vendor_pricing_method)
      ? row.vendor_pricing_method
      : null,
    vendorCost: row.vendor_cost != null ? Number(row.vendor_cost) : null,
    vendorCommissionPercent:
      row.vendor_commission_percent != null ? Number(row.vendor_commission_percent) : null,
    vendorFlatFee: row.vendor_flat_fee != null ? Number(row.vendor_flat_fee) : null,
    isGlobal: row.is_global,
    linkedPropertyIds,
    active: row.active,
    salesCount: row.sales_count,
    revenue: Number(row.revenue),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/upsells — lista el catálogo del tenant.
// Query opcional: ?active=true, ?category=service, ?vendorId=<uuid>
export async function GET(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  let query = supabase
    .from("upsells")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("active", { ascending: false })
    .order("created_at", { ascending: false });

  if (req.nextUrl.searchParams.get("active") === "true") {
    query = query.eq("active", true);
  }
  const cat = req.nextUrl.searchParams.get("category");
  if (cat && isValidCategory(cat)) query = query.eq("category", cat);
  const vendorId = req.nextUrl.searchParams.get("vendorId");
  if (vendorId) query = query.eq("vendor_id", vendorId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    upsells: ((data ?? []) as UpsellRow[]).map(rowToUpsell),
  });
}

// POST /api/upsells — crea un nuevo upsell.
// Required: name + category. El resto tiene defaults razonables.
export async function POST(req: NextRequest) {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }
  if (!(await viewerCanManage(supabase, user?.id, tenantId))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const category = body.category;
  if (!isValidCategory(category)) {
    return NextResponse.json(
      { error: `category inválida. Esperado: ${[...VALID_CATEGORIES].join(", ")}` },
      { status: 400 },
    );
  }

  const priceRaw = body.price;
  const price = typeof priceRaw === "number" ? priceRaw : Number(priceRaw);
  if (!Number.isFinite(price) || price < 0) {
    return NextResponse.json({ error: "price inválido" }, { status: 400 });
  }

  // Validación cross-tenant: vendor_id debe pertenecer al tenant del caller.
  // Sin esto, un admin podría guardar vendor_id de otro tenant — la FK acepta
  // (referential integrity no chequea tenant) y eso leakea datos cuando el
  // Hub público haga JOIN en Sprint 2.
  let vendorId: string | null = null;
  if (typeof body.vendorId === "string" && body.vendorId) {
    if (!(await validateVendorBelongsToTenant(supabase, body.vendorId, tenantId))) {
      return NextResponse.json({ error: "vendorId no pertenece al tenant" }, { status: 422 });
    }
    vendorId = body.vendorId;
  }

  const linkedPropertyIds = Array.isArray(body.linkedPropertyIds)
    ? (body.linkedPropertyIds as string[]).filter((v): v is string => typeof v === "string")
    : [];
  if (linkedPropertyIds.length > 0) {
    if (!(await validatePropertiesBelongToTenant(supabase, linkedPropertyIds, tenantId))) {
      return NextResponse.json(
        { error: "Una o más propiedades no pertenecen al tenant" },
        { status: 422 },
      );
    }
  }

  // Pricing model + capacidad. Defaults razonables si no vienen en el body:
  // fixed/1/null/null/0 = comportamiento legacy compatible con Sprint 1.
  const pricingModel: PricingModel = isValidPricingModel(body.pricingModel)
    ? body.pricingModel
    : "fixed";

  const minQuantity = Number(body.minQuantity ?? 1);
  if (!Number.isInteger(minQuantity) || minQuantity < 1) {
    return NextResponse.json({ error: "minQuantity debe ser entero >= 1" }, { status: 400 });
  }
  let maxQuantity: number | null = null;
  if (body.maxQuantity !== undefined && body.maxQuantity !== null && body.maxQuantity !== "") {
    const m = Number(body.maxQuantity);
    if (!Number.isInteger(m) || m < minQuantity) {
      return NextResponse.json(
        { error: "maxQuantity debe ser entero >= minQuantity" },
        { status: 400 },
      );
    }
    maxQuantity = m;
  }
  let capacityPerSlot: number | null = null;
  if (body.capacityPerSlot !== undefined && body.capacityPerSlot !== null && body.capacityPerSlot !== "") {
    const c = Number(body.capacityPerSlot);
    if (!Number.isInteger(c) || c < 1) {
      return NextResponse.json(
        { error: "capacityPerSlot debe ser entero >= 1" },
        { status: 400 },
      );
    }
    capacityPerSlot = c;
  }
  const cutoffHours = Number(body.cutoffHours ?? 0);
  if (!Number.isInteger(cutoffHours) || cutoffHours < 0) {
    return NextResponse.json({ error: "cutoffHours debe ser entero >= 0" }, { status: 400 });
  }

  // Override opcional del trato con el vendor. Política de consistencia:
  // sin método override, NINGÚN valor de override aplica (se borran todos).
  // Con método override, solo el valor del método activo se conserva — los
  // otros se nulifican para que un toggle commission→fixed_cost no deje
  // restos del valor anterior.
  let vendorPricingMethodOverride: VendorPricingMethod | null = null;
  if (body.vendorPricingMethod !== undefined && body.vendorPricingMethod !== null) {
    if (!isValidVendorPricingMethod(body.vendorPricingMethod)) {
      return NextResponse.json({ error: "vendorPricingMethod inválido" }, { status: 400 });
    }
    vendorPricingMethodOverride = body.vendorPricingMethod;
  }

  let vendorCost: number | null = null;
  let vendorCommissionPercent: number | null = null;
  let vendorFlatFee: number | null = null;

  if (vendorPricingMethodOverride !== null) {
    if (vendorPricingMethodOverride === "fixed_cost") {
      const v = parseNumericNullable(body.vendorCost);
      if (v === undefined) {
        return NextResponse.json({ error: "vendorCost inválido" }, { status: 400 });
      }
      vendorCost = v;
    } else if (vendorPricingMethodOverride === "commission") {
      const v = parseNumericNullable(body.vendorCommissionPercent, 100);
      if (v === undefined) {
        return NextResponse.json({ error: "vendorCommissionPercent inválido" }, { status: 400 });
      }
      vendorCommissionPercent = v;
    } else if (vendorPricingMethodOverride === "flat_fee") {
      const v = parseNumericNullable(body.vendorFlatFee);
      if (v === undefined) {
        return NextResponse.json({ error: "vendorFlatFee inválido" }, { status: 400 });
      }
      vendorFlatFee = v;
    }
  }

  // Fotos: heroPhoto null válido, galleryPhotos array de strings. Validamos
  // que cada URL apunte al bucket del tenant — sin esto, un caller malicioso
  // puede meter https://tracker.com/x.gif y lo serviríamos al huésped.
  let heroPhoto: string | null = null;
  if (typeof body.heroPhoto === "string" && body.heroPhoto) {
    if (!isOwnUpsellPhotoUrl(body.heroPhoto, tenantId)) {
      return NextResponse.json({ error: "heroPhoto URL inválida" }, { status: 422 });
    }
    heroPhoto = body.heroPhoto;
  }
  const galleryRaw = Array.isArray(body.galleryPhotos)
    ? (body.galleryPhotos as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  for (const url of galleryRaw) {
    if (!isOwnUpsellPhotoUrl(url, tenantId)) {
      return NextResponse.json({ error: "galleryPhotos contiene URL inválida" }, { status: 422 });
    }
  }
  const galleryPhotos = galleryRaw;

  const insertRow: Record<string, unknown> = {
    tenant_id: tenantId,
    vendor_id: vendorId,
    name,
    description: typeof body.description === "string" ? body.description : null,
    category,
    icon_name: typeof body.iconName === "string" && body.iconName ? body.iconName : "Sparkles",
    price,
    currency: typeof body.currency === "string" ? body.currency : "USD",
    hero_photo: heroPhoto,
    gallery_photos: galleryPhotos,
    pricing_model: pricingModel,
    min_quantity: minQuantity,
    max_quantity: maxQuantity,
    capacity_per_slot: capacityPerSlot,
    cutoff_hours: cutoffHours,
    vendor_pricing_method: vendorPricingMethodOverride,
    vendor_cost: vendorCost,
    vendor_commission_percent: vendorCommissionPercent,
    vendor_flat_fee: vendorFlatFee,
    is_global: body.isGlobal !== false,
    linked_property_ids: linkedPropertyIds,
    active: body.active !== false,
  };

  const { data, error } = await supabase
    .from("upsells")
    .insert(insertRow as never)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, upsell: rowToUpsell(data as UpsellRow) });
}

// PATCH /api/upsells?id=<uuid> — actualiza campos del upsell.
// Allow-list: name, description, category, iconName, price, vendorId,
// isGlobal, linkedPropertyIds, active. Stats (salesCount/revenue) NO se
// tocan desde acá — los actualiza el flujo de órdenes (sprint próximo).
export async function PATCH(req: NextRequest) {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }
  if (!(await viewerCanManage(supabase, user?.id, tenantId))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (!n) return NextResponse.json({ error: "name no puede ser vacío" }, { status: 400 });
    patch.name = n;
  }
  if (body.description !== undefined) {
    // Coerción defensiva: si llega un objeto/array, lo descartamos. Sin esto
    // Postgres rechaza con 500 genérico cuando el tipo no es text.
    patch.description = typeof body.description === "string" ? body.description : null;
  }
  if (body.category !== undefined) {
    if (!isValidCategory(body.category)) {
      return NextResponse.json({ error: "category inválida" }, { status: 400 });
    }
    patch.category = body.category;
  }
  if (body.iconName !== undefined) {
    patch.icon_name = typeof body.iconName === "string" ? body.iconName : "Sparkles";
  }
  if (body.heroPhoto !== undefined) {
    if (typeof body.heroPhoto === "string" && body.heroPhoto) {
      if (!isOwnUpsellPhotoUrl(body.heroPhoto, tenantId)) {
        return NextResponse.json({ error: "heroPhoto URL inválida" }, { status: 422 });
      }
      patch.hero_photo = body.heroPhoto;
    } else {
      patch.hero_photo = null;
    }
  }
  if (body.galleryPhotos !== undefined) {
    const arr = Array.isArray(body.galleryPhotos)
      ? (body.galleryPhotos as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
    for (const url of arr) {
      if (!isOwnUpsellPhotoUrl(url, tenantId)) {
        return NextResponse.json({ error: "galleryPhotos contiene URL inválida" }, { status: 422 });
      }
    }
    patch.gallery_photos = arr;
  }
  if (body.price !== undefined) {
    const p = typeof body.price === "number" ? body.price : Number(body.price);
    if (!Number.isFinite(p) || p < 0) {
      return NextResponse.json({ error: "price inválido" }, { status: 400 });
    }
    patch.price = p;
  }
  // Validación cross-tenant en update también (caller podría meter vendor
  // de otro tenant ahora que el upsell ya existe).
  if (body.vendorId !== undefined) {
    if (body.vendorId === null || body.vendorId === "") {
      patch.vendor_id = null;
    } else if (typeof body.vendorId === "string") {
      if (!(await validateVendorBelongsToTenant(supabase, body.vendorId, tenantId))) {
        return NextResponse.json(
          { error: "vendorId no pertenece al tenant" },
          { status: 422 },
        );
      }
      patch.vendor_id = body.vendorId;
    }
  }
  // Pricing model + capacidad. La restricción cross-column
  // max_quantity >= min_quantity la enforce el CHECK constraint en BD, pero
  // si solo viene uno de los dos en el patch, prefetcheamos el otro para
  // devolver 400 con mensaje legible en lugar de un 500 genérico de Postgres.
  if (body.pricingModel !== undefined) {
    if (!isValidPricingModel(body.pricingModel)) {
      return NextResponse.json({ error: "pricingModel inválido" }, { status: 400 });
    }
    patch.pricing_model = body.pricingModel;
  }

  const hasMinPatch = body.minQuantity !== undefined;
  const hasMaxPatch = body.maxQuantity !== undefined;

  if (hasMinPatch) {
    const m = Number(body.minQuantity);
    if (!Number.isInteger(m) || m < 1) {
      return NextResponse.json({ error: "minQuantity inválido" }, { status: 400 });
    }
    patch.min_quantity = m;
  }
  if (hasMaxPatch) {
    if (body.maxQuantity === null || body.maxQuantity === "") {
      patch.max_quantity = null;
    } else {
      const m = Number(body.maxQuantity);
      if (!Number.isInteger(m) || m < 1) {
        return NextResponse.json({ error: "maxQuantity inválido" }, { status: 400 });
      }
      patch.max_quantity = m;
    }
  }

  // Si viene solo uno de los dos, leemos el valor existente del row para
  // validar el rango antes de mandar el UPDATE — sin esto el CHECK explota
  // como 500 genérico al usuario.
  if ((hasMinPatch || hasMaxPatch) && !(hasMinPatch && hasMaxPatch)) {
    const { data: existing } = await supabase
      .from("upsells")
      .select("min_quantity, max_quantity")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const row = existing as { min_quantity: number; max_quantity: number | null } | null;
    if (row) {
      const finalMin = (patch.min_quantity as number | undefined) ?? row.min_quantity;
      const finalMax =
        patch.max_quantity === null
          ? null
          : ((patch.max_quantity as number | undefined) ?? row.max_quantity);
      if (finalMax !== null && finalMax < finalMin) {
        return NextResponse.json(
          { error: `maxQuantity (${finalMax}) no puede ser menor que minQuantity (${finalMin})` },
          { status: 400 },
        );
      }
    }
  }
  if (body.capacityPerSlot !== undefined) {
    if (body.capacityPerSlot === null || body.capacityPerSlot === "") {
      patch.capacity_per_slot = null;
    } else {
      const c = Number(body.capacityPerSlot);
      if (!Number.isInteger(c) || c < 1) {
        return NextResponse.json({ error: "capacityPerSlot inválido" }, { status: 400 });
      }
      patch.capacity_per_slot = c;
    }
  }
  if (body.cutoffHours !== undefined) {
    const c = Number(body.cutoffHours);
    if (!Number.isInteger(c) || c < 0) {
      return NextResponse.json({ error: "cutoffHours inválido" }, { status: 400 });
    }
    patch.cutoff_hours = c;
  }
  // Override del trato con vendor — política de consistencia:
  // Si el patch incluye vendorPricingMethod (cualquiera de los 4 fields del
  // override), reseteamos los 4 según el método final. Esto evita estados
  // sucios tipo "method=commission pero vendor_cost=50".
  const overrideKeys = ["vendorPricingMethod", "vendorCost", "vendorCommissionPercent", "vendorFlatFee"];
  const touchesOverride = overrideKeys.some((k) => k in body);
  if (touchesOverride) {
    let methodFinal: VendorPricingMethod | null = null;
    if (body.vendorPricingMethod !== undefined) {
      if (body.vendorPricingMethod === null) {
        methodFinal = null;
      } else if (isValidVendorPricingMethod(body.vendorPricingMethod)) {
        methodFinal = body.vendorPricingMethod;
      } else {
        return NextResponse.json({ error: "vendorPricingMethod inválido" }, { status: 400 });
      }
    } else {
      // Si tocan los valores pero no el método, leemos el método actual de BD
      const { data: row } = await supabase
        .from("upsells")
        .select("vendor_pricing_method")
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      methodFinal = (row as { vendor_pricing_method: string | null } | null)?.vendor_pricing_method as
        | VendorPricingMethod
        | null
        ?? null;
    }
    patch.vendor_pricing_method = methodFinal;
    patch.vendor_cost = null;
    patch.vendor_commission_percent = null;
    patch.vendor_flat_fee = null;
    if (methodFinal === "fixed_cost" && body.vendorCost !== undefined) {
      const v = parseNumericNullable(body.vendorCost);
      if (v === undefined) {
        return NextResponse.json({ error: "vendorCost inválido" }, { status: 400 });
      }
      patch.vendor_cost = v;
    }
    if (methodFinal === "commission" && body.vendorCommissionPercent !== undefined) {
      const v = parseNumericNullable(body.vendorCommissionPercent, 100);
      if (v === undefined) {
        return NextResponse.json({ error: "vendorCommissionPercent inválido" }, { status: 400 });
      }
      patch.vendor_commission_percent = v;
    }
    if (methodFinal === "flat_fee" && body.vendorFlatFee !== undefined) {
      const v = parseNumericNullable(body.vendorFlatFee);
      if (v === undefined) {
        return NextResponse.json({ error: "vendorFlatFee inválido" }, { status: 400 });
      }
      patch.vendor_flat_fee = v;
    }
  }
  if (body.isGlobal !== undefined) patch.is_global = !!body.isGlobal;
  if (body.linkedPropertyIds !== undefined) {
    const ids = Array.isArray(body.linkedPropertyIds)
      ? (body.linkedPropertyIds as string[]).filter((v): v is string => typeof v === "string")
      : [];
    if (ids.length > 0 && !(await validatePropertiesBelongToTenant(supabase, ids, tenantId))) {
      return NextResponse.json(
        { error: "Una o más propiedades no pertenecen al tenant" },
        { status: 422 },
      );
    }
    patch.linked_property_ids = ids;
  }
  if (body.active !== undefined) patch.active = !!body.active;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No updatable fields" }, { status: 400 });
  }

  // Defensa en profundidad: filtramos por `tenant_id` además del id. RLS ya
  // lo cubre, pero si en el futuro este endpoint se reescribe con
  // supabaseAdmin (patrón pendiente de refactor), este filtro lo blinda.
  const { error, count } = await supabase
    .from("upsells")
    .update(patch as never, { count: "exact" })
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/upsells?id=<uuid>
export async function DELETE(req: NextRequest) {
  const { user, tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }
  if (!(await viewerCanManage(supabase, user?.id, tenantId))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Leer las URLs de fotos antes de borrar el row, para limpiar Storage
  // después. Best-effort — si Storage falla, igual se elimina el upsell.
  const { data: photoRow } = await supabase
    .from("upsells")
    .select("hero_photo, gallery_photos")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  // Defensa en profundidad: doble filtro (RLS + tenant_id explícito).
  const { error, count } = await supabase
    .from("upsells")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Cleanup de Storage. Extrae el path interno del bucket desde la URL.
  if (photoRow) {
    const row = photoRow as { hero_photo: string | null; gallery_photos: unknown };
    const urls: string[] = [];
    if (row.hero_photo) urls.push(row.hero_photo);
    if (Array.isArray(row.gallery_photos)) {
      for (const u of row.gallery_photos as unknown[]) {
        if (typeof u === "string") urls.push(u);
      }
    }
    const paths = urls
      .map((url) => {
        const marker = "/storage/v1/object/public/upsell-photos/";
        const idx = url.indexOf(marker);
        return idx >= 0 ? url.slice(idx + marker.length) : null;
      })
      .filter((p): p is string => !!p);
    if (paths.length > 0) {
      await supabase.storage.from("upsell-photos").remove(paths).catch((e) => {
        console.warn("[/api/upsells DELETE] Storage cleanup failed (non-fatal):", e);
      });
    }
  }

  return NextResponse.json({ ok: true });
}
