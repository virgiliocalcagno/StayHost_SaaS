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

export function batteryColor(pct: number) {
  if (pct <= 15) return "text-red-500";
  if (pct <= 35) return "text-amber-500";
  return "text-green-500";
}

export function batteryBg(pct: number) {
  if (pct <= 15) return "[&>div]:bg-red-500";
  if (pct <= 35) return "[&>div]:bg-amber-500";
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
