// Privacidad de montos por rol — server-side.
//
// Nunca confiar en el cliente para ocultar $. Este helper se aplica en los
// endpoints que sirven cleaning_tasks antes de devolver al cliente.
//
// Matriz canónica (docs/modulo-limpieza-modelo-canonico.md §5):
//
//   admin                     ve todos los precios
//   supervisor (contractor)   ve cleaner_payout (su equipo) + supervisor_payout (el suyo)
//   supervisor (employee)     no ve $
//   cleaner   (contractor)    ve solo cleaner_payout en sus propias tareas
//   cleaner   (employee)      no ve $
//   maintenance               como cleaner

export type Role = "admin" | "supervisor" | "cleaner" | "maintenance" | string;
export type EmploymentType = "contractor" | "employee";

export interface ViewerContext {
  role: Role;
  employmentType: EmploymentType;
  // ID del team_member que está mirando — necesario para "es mi tarea / es mi
  // equipo" cuando el rol no es admin.
  memberId: string;
}

export interface MoneyFields {
  client_price?: number | string | null;
  cleaner_payout?: number | string | null;
  supervisor_payout?: number | string | null;
  currency?: string | null;
}

export interface TaskMoneyContext extends MoneyFields {
  // Datos para decidir "es mi tarea / es mi equipo".
  assignee_id?: string | null;
  // supervisor_id de la propiedad de la tarea (la tarea hereda de la
  // propiedad — no se duplica columna).
  property_supervisor_id?: string | null;
}

/**
 * Devuelve un objeto con SOLO las columnas $ que el viewer puede ver para
 * esta tarea. Las columnas no visibles se OMITEN (no se ponen a null) para
 * que el cliente no pueda inferir su existencia.
 */
export function filterMoneyForViewer<T extends TaskMoneyContext>(
  task: T,
  viewer: ViewerContext,
): Omit<T, "client_price" | "cleaner_payout" | "supervisor_payout"> &
  Partial<MoneyFields> {
  const {
    client_price,
    cleaner_payout,
    supervisor_payout,
    currency,
    ...rest
  } = task;

  const out: Partial<MoneyFields> = {};
  if (currency != null) out.currency = currency;

  // Employee no ve $ jamás.
  if (viewer.employmentType === "employee" && viewer.role !== "admin") {
    return { ...rest, ...out } as Omit<
      T,
      "client_price" | "cleaner_payout" | "supervisor_payout"
    > &
      Partial<MoneyFields>;
  }

  if (viewer.role === "admin") {
    if (client_price != null) out.client_price = client_price;
    if (cleaner_payout != null) out.cleaner_payout = cleaner_payout;
    if (supervisor_payout != null) out.supervisor_payout = supervisor_payout;
  } else if (viewer.role === "supervisor") {
    // Ve cleaner_payout solo de su equipo (su tarea o de un cleaner que
    // reporta a este supervisor — eso lo determina el caller chequeando
    // property_supervisor_id contra viewer.memberId).
    const isMyTeam = task.property_supervisor_id === viewer.memberId;
    if (isMyTeam && cleaner_payout != null) {
      out.cleaner_payout = cleaner_payout;
    }
    // Supervisor_payout: solo si la tarea es suya (la cobra él).
    if (
      task.assignee_id === viewer.memberId &&
      supervisor_payout != null
    ) {
      out.supervisor_payout = supervisor_payout;
    }
  } else if (viewer.role === "cleaner" || viewer.role === "maintenance") {
    // Cleaner contractor: solo ve su payout en sus tareas.
    if (
      task.assignee_id === viewer.memberId &&
      cleaner_payout != null
    ) {
      out.cleaner_payout = cleaner_payout;
    }
  }

  return { ...rest, ...out } as Omit<
    T,
    "client_price" | "cleaner_payout" | "supervisor_payout"
  > &
    Partial<MoneyFields>;
}
