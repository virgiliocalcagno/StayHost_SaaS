/**
 * Shared helpers and static labels for the Smart Devices module.
 *
 * Pure functions only — anything that touches state lives in the component
 * that owns it, or in a custom hook.
 */

import type React from "react";
import { Lock, Thermometer, Activity, Droplets, Eye } from "lucide-react";
import type { DeviceType } from "./types";

// ─── Static maps ──────────────────────────────────────────────────────────

export const DEVICE_ICONS: Record<DeviceType, React.ElementType> = {
  lock_ttlock: Lock,
  lock_tuya: Lock,
  thermostat: Thermometer,
  sensor_temp: Activity,
  sensor_pool: Droplets,
  camera: Eye,
};

export const DEVICE_LABELS: Record<DeviceType, string> = {
  lock_ttlock: "Cerradura TTLock",
  lock_tuya: "Cerradura Tuya",
  thermostat: "Termostato",
  sensor_temp: "Sensor Temp/Humedad",
  sensor_pool: "Sensor Piscina",
  camera: "Cámara IP",
};

export const CHANNEL_LABELS: Record<string, string> = {
  airbnb: "Airbnb",
  vrbo: "VRBO",
  booking: "Booking.com",
  other: "Otro",
};

export const CHANNEL_COLORS: Record<string, string> = {
  airbnb: "bg-rose-500",
  vrbo: "bg-blue-500",
  booking: "bg-blue-700",
  other: "bg-slate-500",
};

// ─── Pure helpers ─────────────────────────────────────────────────────────

// Bateria escalonada en dos niveles operativos:
//   <= 30%: critico — cambio inmediato, riesgo de cerradura no funcional
//   <= 50%: medio   — cambio pronto, todavia opera bien
//   > 50%:  ok
// Las cerraduras TTLock empiezan a fallar bajo 20%, pero no esperamos
// hasta ahi: planificacion preventiva es mas barato que un huesped sin
// acceso a las 11pm.
export const BATTERY_CRITICAL_THRESHOLD = 30;
export const BATTERY_WARNING_THRESHOLD = 50;

export function batteryColor(pct: number) {
  if (pct <= BATTERY_CRITICAL_THRESHOLD) return "text-red-500";
  if (pct <= BATTERY_WARNING_THRESHOLD) return "text-amber-500";
  return "text-green-500";
}

export function batteryBg(pct: number) {
  if (pct <= BATTERY_CRITICAL_THRESHOLD) return "[&>div]:bg-red-500";
  if (pct <= BATTERY_WARNING_THRESHOLD) return "[&>div]:bg-amber-500";
  return "[&>div]:bg-green-500";
}

export function isExpiredPin(validTo: string) {
  return new Date(validTo) < new Date();
}

export function formatDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Convierte un valor de <input type="datetime-local" /> — que no lleva zona
 * horaria pero representa la hora local del navegador — a un ISO UTC completo
 * listo para guardarse en una columna `timestamptz`.
 *
 * Ejemplo: en Santo Domingo (UTC-4), "2026-04-19T14:20" → "2026-04-19T18:20:00.000Z".
 *
 * Sin este helper, Postgres interpreta el string sin zona como UTC directo y
 * guarda 14:20 UTC (= 10:20 AM AST), lo que hace que el PIN se vea "Expirado"
 * apenas lo creas.
 */
export function localInputToIso(local: string): string {
  if (!local) return "";
  const d = new Date(local); // el constructor interpreta strings sin TZ como local
  if (isNaN(d.getTime())) return "";
  return d.toISOString();
}

/**
 * Inverso de localInputToIso: toma un timestamp ISO del DB (en UTC) y lo
 * devuelve como "YYYY-MM-DDTHH:MM" en la zona local del navegador, listo para
 * pre-llenar un <input type="datetime-local" />.
 */
export function isoToLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}
