// Helpers de estado de cleaning_tasks compartidos entre el cronograma
// (CleaningPanel) y el modal de detalle (CleaningTaskDetailModal). Antes
// de extraer aqui, ambos archivos tenian implementaciones casi iguales
// que divergian en sutilezas (ej. cual lista de status disparaba el
// downgrade a "unassigned"), causando que la misma tarea se viera con un
// status en la tarjeta y otro en el modal.

export type TaskWithStatus = {
  status: string;
  assigneeId?: string;
};

// Estados que requieren un assignee. Si la fila tiene uno de estos pero
// `assigneeId` es null/undefined, es estado inconsistente sembrado por
// flujos viejos y debe re-leerse como "unassigned".
//
// Nota: NO incluimos "rejected" — un staff puede haber rechazado y la
// tarea quedar a la espera de reasignacion. Conservar el estado "rejected"
// preserva el motivo y el badge para que el owner sepa por que esta huerfana.
const ASSIGNEE_REQUIRED: ReadonlySet<string> = new Set([
  "assigned",
  "accepted",
  "in_progress",
]);

// Caso simetrico: status = "unassigned" pero la fila SI tiene assigneeId.
// Pasa cuando un Select inline actualiza assignee_id sin tocar el status.
// El effective status debe re-leerse como "assigned" para que la UI sea
// coherente con el dato real (avatar visible, nombre del staff, etc.).
function isOrphanedAssignment(task: TaskWithStatus): boolean {
  return (task.status === "unassigned" || task.status === "pending") && !!task.assigneeId;
}

export function isStatusInconsistent(task: TaskWithStatus): boolean {
  return (ASSIGNEE_REQUIRED.has(task.status) && !task.assigneeId) || isOrphanedAssignment(task);
}

// Status visible derivado del dato real. Sin esto la UI puede mostrar
// "Asignada" (badge azul) y "Sin asignar" (pill amber) al mismo tiempo
// para la misma tarea cuando hay inconsistencia entre `status` y
// `assigneeId`. Cubre ambos sentidos:
//   - status="assigned" sin assigneeId → "unassigned"
//   - status="unassigned"/"pending" con assigneeId → "assigned"
export function getEffectiveStatus(task: TaskWithStatus): string {
  if (task.status === "completed" || task.status === "issue") {
    return task.status;
  }
  if (ASSIGNEE_REQUIRED.has(task.status) && !task.assigneeId) return "unassigned";
  if (isOrphanedAssignment(task)) return "assigned";
  return task.status;
}

// Status que la fila DEBERIA tener segun el dato real. Lo usa el auto-heal
// para reescribir el campo en BD y mantener coherencia entre vistas que no
// pasan por getEffectiveStatus (ej. KPIs que cuentan filas por status).
export function deriveCorrectStatus(task: TaskWithStatus): string | null {
  if (ASSIGNEE_REQUIRED.has(task.status) && !task.assigneeId) return "unassigned";
  if (isOrphanedAssignment(task)) return "assigned";
  return null;
}
