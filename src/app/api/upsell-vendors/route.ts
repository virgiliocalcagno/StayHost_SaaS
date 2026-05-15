/**
 * /api/upsell-vendors — CRUD del directorio de proveedores de la tienda
 * (capitanes, conductores, spa, chef, etc.).
 *
 * Separado de /api/vendors (service_vendors), que maneja proveedores
 * operativos del host (plomero, contador, internet). Ver migración
 * 20260515_upsell_vendors_and_pricing.sql para el rationale.
 *
 * Auth: tenant_id desde sesión + role guard (owner/admin/manager/co_host).
 * RLS sobre upsell_vendors filtra cross-tenant; el tenant_id explícito en
 * UPDATE/DELETE es defensa en profundidad.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  UpsellVendor,
  UpsellVendorCategory,
  PaymentTerms,
} from "@/types/upsellVendor";

const VALID_CATEGORIES = new Set<UpsellVendorCategory>([
  "excursion",
  "transport",
  "food",
  "laundry",
  "spa",
  "concierge",
  "other",
]);
const isValidCategory = (v: unknown): v is UpsellVendorCategory =>
  typeof v === "string" && (VALID_CATEGORIES as Set<string>).has(v);

const VALID_PAYMENT_TERMS = new Set<PaymentTerms>([
  "on_completion",
  "pre_paid",
  "split",
]);
const isValidPaymentTerms = (v: unknown): v is PaymentTerms =>
  typeof v === "string" && (VALID_PAYMENT_TERMS as Set<string>).has(v);

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
  if (!data) return true; // owner directo sin team_member row
  const row = data as { role: string | null };
  return !!row.role && MANAGE_ROLES.has(row.role);
}

type VendorRow = {
  id: string;
  tenant_id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  rnc_cedula: string | null;
  category: string;
  display_name: string | null;
  hero_photo: string | null;
  description: string | null;
  languages: unknown;
  commission_percent: string | number;
  payment_terms: string;
  agreement_accepted_at: string | null;
  agreement_version: string | null;
  agreement_pdf_path: string | null;
  accepted_by_name: string | null;
  accepted_by_id_doc: string | null;
  rating: number | null;
  total_orders: number;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function rowToVendor(row: VendorRow): UpsellVendor {
  const langs = Array.isArray(row.languages) ? (row.languages as string[]) : [];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    contactName: row.contact_name,
    phone: row.phone,
    email: row.email,
    rncCedula: row.rnc_cedula,
    category: isValidCategory(row.category) ? row.category : "other",
    displayName: row.display_name,
    heroPhoto: row.hero_photo,
    description: row.description,
    languages: langs,
    commissionPercent: Number(row.commission_percent),
    paymentTerms: isValidPaymentTerms(row.payment_terms) ? row.payment_terms : "on_completion",
    agreementAcceptedAt: row.agreement_accepted_at,
    agreementVersion: row.agreement_version,
    agreementPdfPath: row.agreement_pdf_path,
    acceptedByName: row.accepted_by_name,
    acceptedByIdDoc: row.accepted_by_id_doc,
    rating: row.rating,
    totalOrders: row.total_orders,
    active: row.active,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/upsell-vendors — lista del tenant
// Query opcional: ?active=true, ?category=excursion
export async function GET(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  let query = supabase
    .from("upsell_vendors")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("active", { ascending: false })
    .order("name", { ascending: true });

  if (req.nextUrl.searchParams.get("active") === "true") {
    query = query.eq("active", true);
  }
  const cat = req.nextUrl.searchParams.get("category");
  if (cat && isValidCategory(cat)) query = query.eq("category", cat);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    vendors: ((data ?? []) as VendorRow[]).map(rowToVendor),
  });
}

// POST /api/upsell-vendors
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

  const category = body.category ?? "other";
  if (!isValidCategory(category)) {
    return NextResponse.json({ error: "category inválida" }, { status: 400 });
  }

  const paymentTerms = body.paymentTerms ?? "on_completion";
  if (!isValidPaymentTerms(paymentTerms)) {
    return NextResponse.json({ error: "paymentTerms inválido" }, { status: 400 });
  }

  const commissionRaw = body.commissionPercent;
  const commission =
    commissionRaw === undefined
      ? 0
      : typeof commissionRaw === "number"
        ? commissionRaw
        : Number(commissionRaw);
  if (!Number.isFinite(commission) || commission < 0 || commission > 100) {
    return NextResponse.json({ error: "commissionPercent fuera de rango" }, { status: 400 });
  }

  const languages = Array.isArray(body.languages)
    ? (body.languages as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  const insertRow: Record<string, unknown> = {
    tenant_id: tenantId,
    name,
    contact_name: typeof body.contactName === "string" ? body.contactName : null,
    phone: typeof body.phone === "string" ? body.phone : null,
    email: typeof body.email === "string" ? body.email : null,
    rnc_cedula: typeof body.rncCedula === "string" ? body.rncCedula : null,
    category,
    display_name: typeof body.displayName === "string" ? body.displayName : null,
    hero_photo: typeof body.heroPhoto === "string" ? body.heroPhoto : null,
    description: typeof body.description === "string" ? body.description : null,
    languages,
    commission_percent: commission,
    payment_terms: paymentTerms,
    notes: typeof body.notes === "string" ? body.notes : null,
    active: body.active !== false,
  };

  const { data, error } = await supabase
    .from("upsell_vendors")
    .insert(insertRow as never)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, vendor: rowToVendor(data as VendorRow) });
}

// PATCH /api/upsell-vendors?id=<uuid>
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
  if (body.contactName !== undefined) patch.contact_name = typeof body.contactName === "string" ? body.contactName : null;
  if (body.phone !== undefined) patch.phone = typeof body.phone === "string" ? body.phone : null;
  if (body.email !== undefined) patch.email = typeof body.email === "string" ? body.email : null;
  if (body.rncCedula !== undefined) patch.rnc_cedula = typeof body.rncCedula === "string" ? body.rncCedula : null;
  if (body.category !== undefined) {
    if (!isValidCategory(body.category)) {
      return NextResponse.json({ error: "category inválida" }, { status: 400 });
    }
    patch.category = body.category;
  }
  if (body.displayName !== undefined) patch.display_name = typeof body.displayName === "string" ? body.displayName : null;
  if (body.heroPhoto !== undefined) patch.hero_photo = typeof body.heroPhoto === "string" ? body.heroPhoto : null;
  if (body.description !== undefined) patch.description = typeof body.description === "string" ? body.description : null;
  if (body.languages !== undefined) {
    patch.languages = Array.isArray(body.languages)
      ? (body.languages as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
  }
  if (body.commissionPercent !== undefined) {
    const c = typeof body.commissionPercent === "number" ? body.commissionPercent : Number(body.commissionPercent);
    if (!Number.isFinite(c) || c < 0 || c > 100) {
      return NextResponse.json({ error: "commissionPercent fuera de rango" }, { status: 400 });
    }
    patch.commission_percent = c;
  }
  if (body.paymentTerms !== undefined) {
    if (!isValidPaymentTerms(body.paymentTerms)) {
      return NextResponse.json({ error: "paymentTerms inválido" }, { status: 400 });
    }
    patch.payment_terms = body.paymentTerms;
  }
  if (body.notes !== undefined) patch.notes = typeof body.notes === "string" ? body.notes : null;
  if (body.active !== undefined) patch.active = !!body.active;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No updatable fields" }, { status: 400 });
  }

  const { error, count } = await supabase
    .from("upsell_vendors")
    .update(patch as never, { count: "exact" })
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/upsell-vendors?id=<uuid>
// Los upsells que referenciaban a este vendor quedan con vendor_id=null
// (FK on delete set null). El upsell sigue vendible — el host lo entrega
// o lo reasigna a otro vendor.
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

  const { error, count } = await supabase
    .from("upsell_vendors")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
