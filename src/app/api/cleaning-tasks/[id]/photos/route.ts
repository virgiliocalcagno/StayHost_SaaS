import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant, supabaseAdmin } from "@/lib/supabase/server";

const BUCKET = "cleaning-evidence";
const MAX_BYTES = 1_000_000; // 1MB tras compresión client-side
const SIGNED_URL_TTL_SECONDS = 60 * 60;

type PhotoEntry = {
  category: string;
  path?: string;        // shape nuevo (Storage)
  url?: string;         // shape viejo (mocks unsplash) — solo lectura legacy
  uploaded_at?: string;
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    || "categoria";
}

async function loadTask(id: string, tenantId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- no generated DB types
  const { data, error } = await (supabaseAdmin.from("cleaning_tasks") as any)
    .select("id, tenant_id, assignee_id, status, closure_photos")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw error;
  return data as
    | { id: string; tenant_id: string; assignee_id: string | null; status: string | null; closure_photos: PhotoEntry[] | null }
    | null;
}

// POST /api/cleaning-tasks/[id]/photos
// multipart/form-data: file (Blob jpeg), category (string)
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: taskId } = await ctx.params;
  const { user, tenantId } = await getAuthenticatedTenant();
  if (!user || !tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const task = await loadTask(taskId, tenantId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Solo el assignee de la tarea puede subir fotos. Admin/supervisor revisa
  // pero no fotografía. La validación de assignee va por team_members.auth_user_id.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- no generated DB types
  const { data: memberRow } = await (supabaseAdmin.from("team_members") as any)
    .select("id")
    .eq("auth_user_id", user.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const memberId = (memberRow as { id: string } | null)?.id ?? null;
  if (!memberId || memberId !== task.assignee_id) {
    return NextResponse.json(
      { error: "Solo el asignado puede subir fotos de evidencia" },
      { status: 403 },
    );
  }

  if (task.status !== "in_progress") {
    return NextResponse.json(
      { error: "La tarea no está en progreso" },
      { status: 409 },
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  const category = String(form.get("category") ?? "").trim();
  if (!(file instanceof Blob) || !category) {
    return NextResponse.json(
      { error: "Faltan campos: file y category" },
      { status: 400 },
    );
  }
  if (file.type !== "image/jpeg") {
    return NextResponse.json(
      { error: "Solo JPEG. Recibido: " + file.type },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Imagen muy grande (${file.size}b). Máximo ${MAX_BYTES}b` },
      { status: 413 },
    );
  }

  const path = `${tenantId}/${taskId}/${slugify(category)}.jpg`;
  const arrayBuf = await file.arrayBuffer();

  const { error: uploadErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, arrayBuf, {
      contentType: "image/jpeg",
      upsert: true,
    });
  if (uploadErr) {
    console.error("[/api/cleaning-tasks/photos] upload failed:", uploadErr);
    return NextResponse.json(
      { error: "No se pudo subir la imagen" },
      { status: 500 },
    );
  }

  const uploadedAt = new Date().toISOString();
  const existing = Array.isArray(task.closure_photos) ? task.closure_photos : [];
  const filtered = existing.filter((p) => p.category !== category);
  const next = [...filtered, { category, path, uploaded_at: uploadedAt }];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- no generated DB types
  const { error: updateErr } = await (supabaseAdmin.from("cleaning_tasks") as any)
    .update({ closure_photos: next })
    .eq("id", taskId);
  if (updateErr) {
    console.error("[/api/cleaning-tasks/photos] update failed:", updateErr);
    return NextResponse.json(
      { error: "Foto subida pero no se pudo registrar" },
      { status: 500 },
    );
  }

  const { data: signed } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  return NextResponse.json({
    category,
    path,
    uploaded_at: uploadedAt,
    url: signed?.signedUrl ?? null,
  });
}

// GET /api/cleaning-tasks/[id]/photos
// Devuelve cada entrada de closure_photos con una signed URL fresca.
// Sirve tanto al cleaner (preview en wizard) como al supervisor (CleaningPanel).
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: taskId } = await ctx.params;
  const { user, tenantId } = await getAuthenticatedTenant();
  if (!user || !tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const task = await loadTask(taskId, tenantId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const photos = Array.isArray(task.closure_photos) ? task.closure_photos : [];
  const result = await Promise.all(
    photos.map(async (p) => {
      // Shape viejo (mocks unsplash) — devolvemos url tal cual.
      if (p.url && !p.path) {
        return { category: p.category, url: p.url, uploaded_at: p.uploaded_at ?? null, legacy: true };
      }
      if (!p.path) return null;
      const { data: signed } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(p.path, SIGNED_URL_TTL_SECONDS);
      return {
        category: p.category,
        url: signed?.signedUrl ?? null,
        uploaded_at: p.uploaded_at ?? null,
        legacy: false,
      };
    }),
  );

  return NextResponse.json({ photos: result.filter(Boolean) });
}
