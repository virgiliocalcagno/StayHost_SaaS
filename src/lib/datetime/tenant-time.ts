export const DEFAULT_TENANT_TZ = "America/Santo_Domingo";

export type TenantTz = string;

function safeDate(input: string | Date): Date | null {
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  if (typeof input !== "string" || input.length === 0) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(input)
    ? `${input}T00:00:00`
    : input;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatTenantDate(
  input: string | Date | null | undefined,
  tz: TenantTz = DEFAULT_TENANT_TZ,
  opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" },
  locale: string = "es-ES",
): string {
  if (input == null) return "—";
  const d = safeDate(input);
  if (!d) return typeof input === "string" ? input : "—";
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: tz }).format(d);
}

export function formatTenantDateTime(
  input: string | Date | null | undefined,
  tz: TenantTz = DEFAULT_TENANT_TZ,
  locale: string = "es-ES",
): string {
  return formatTenantDate(
    input,
    tz,
    { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" },
    locale,
  );
}

export function formatTenantLongDate(
  input: string | Date | null | undefined,
  tz: TenantTz = DEFAULT_TENANT_TZ,
  locale: string = "es-ES",
): string {
  return formatTenantDate(
    input,
    tz,
    { weekday: "long", day: "numeric", month: "long", year: "numeric" },
    locale,
  );
}

export function getTodayInTenant(tz: TenantTz = DEFAULT_TENANT_TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function getDateInTenant(
  input: string | Date,
  tz: TenantTz = DEFAULT_TENANT_TZ,
): string {
  const d = safeDate(input);
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isSameDayInTenant(
  a: string | Date,
  b: string | Date,
  tz: TenantTz = DEFAULT_TENANT_TZ,
): boolean {
  return getDateInTenant(a, tz) === getDateInTenant(b, tz);
}

export function isTodayInTenant(
  input: string | Date,
  tz: TenantTz = DEFAULT_TENANT_TZ,
): boolean {
  return getDateInTenant(input, tz) === getTodayInTenant(tz);
}

export function addDaysInTenant(
  input: string | Date,
  days: number,
  tz: TenantTz = DEFAULT_TENANT_TZ,
): string {
  const ymd = getDateInTenant(input, tz);
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function diffDaysInTenant(
  start: string | Date,
  end: string | Date,
  tz: TenantTz = DEFAULT_TENANT_TZ,
): number {
  const a = getDateInTenant(start, tz);
  const b = getDateInTenant(end, tz);
  if (!a || !b) return 0;
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ms =
    Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86_400_000);
}

export function formatTenantDateRange(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
  tz: TenantTz = DEFAULT_TENANT_TZ,
  locale: string = "es-ES",
): string {
  const s = formatTenantDate(start, tz, { day: "2-digit", month: "short" }, locale);
  const e = formatTenantDate(end, tz, { day: "2-digit", month: "short", year: "numeric" }, locale);
  if (s === "—" && e === "—") return "—";
  if (s === "—") return e;
  if (e === "—") return s;
  return `${s} → ${e}`;
}
