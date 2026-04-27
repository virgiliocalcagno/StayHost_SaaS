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

export function isStatusInconsistent(task: TaskWithStatus): boolean {
  return ASSIGNEE_REQUIRED.has(task.status) && !task.assigneeId;
}

// Status visible derivado del dato real. Sin esto la UI puede mostrar
// "Asignada" (badge azul) y "Sin asignar" (pill amber) al mismo tiempo
// para la misma tarea cuando hay inconsistencia entre `status` y
// `assigneeId`.
export function getEffectiveStatus(task: TaskWithStatus): string {
  if (task.status === "completed" || task.status === "issue") {
    return task.status;
  }
  if (isStatusInconsistent(task)) return "unassigned";
  return task.status;
}
