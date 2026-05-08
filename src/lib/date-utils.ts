// Helpers de fecha basados en strings ISO YYYY-MM-DD operando en UTC.
//
// Útiles para agrupar/desplazar fechas calendario sin importar el huso del
// servidor o cliente. Para conversión local-aware (Sprint Z) ver
// project_sprint_z_timezone.md.

export function mondayOf(dateIso: string): string {
  const d = new Date(dateIso + "T00:00:00Z");
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
