import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedTenant } from "@/lib/supabase/server";
import { syncStaffPinForTask } from "@/lib/staff-access/sync-task";

/**
 * POST /api/staff-access/sync-task
 * Body: { taskId }
 *
 * Reconcilia el access_pin de TTLock para una tarea de limpieza.
 * Wrapper HTTP — la lógica vive en `@/lib/staff-access/sync-task`.
 */
export async function POST(req: NextRequest) {
  const { tenantId, supabase } = await getAuthenticatedTenant();
  if (!tenantId) {
    return NextResponse.json({ error: "No tenant linked to this user" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const taskId = String(body.taskId ?? "");
  if (!taskId) return NextResponse.json({ error: "taskId requerido" }, { status: 400 });

  const result = await syncStaffPinForTask({ supabase, tenantId, taskId });
  if (!result.ok) {
    const status = result.action === "not_found" ? 404 : 500;
    return NextResponse.json({ error: result.error ?? "sync failed" }, { status });
  }
  return NextResponse.json(result);
}
