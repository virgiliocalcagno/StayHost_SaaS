/**
 * Shared types for the Smart Devices module.
 *
 * All interfaces used across the dashboard/smart-devices/* tree live here so
 * the container and tab components agree on shape. If a type is only used
 * inside a single file, keep it local to that file.
 */

import type { ParsedICalBooking } from "@/utils/icalParser";

// ─── Enums ─────────────────────────────────────────────────────────────────

export type DeviceType =
  | "lock_ttlock"
  | "lock_tuya"
  | "thermostat"
  | "sensor_temp"
  | "sensor_pool"
  | "camera";

export type DeviceProvider = "ttlock" | "tuya" | "manual";

export type TabType = "devices" | "pins" | "ical" | "config";

// ─── Entities ──────────────────────────────────────────────────────────────

export interface SmartDevice {
  id: string;
  /** Tuya device_id or TTLock lockId */
  remoteId: string;
  name: string;
  type: DeviceType;
  provider: DeviceProvider;
  propertyId: string;
  propertyName: string;
  online: boolean;
  battery?: number;
  /** Celsius × 10 (Tuya raw) or direct Celsius */
  temperature?: number;
  humidity?: number;
  locked?: boolean;
  lastSync?: string;
}

export interface AccessPin {
  id: string;
  deviceId: string;
  deviceName: string;
  propertyId: string;
  propertyName: string;
  guestName: string;
  guestPhone?: string;
  pin: string;
  source: "airbnb_ical" | "vrbo_ical" | "direct_booking" | "manual";
  bookingRef?: string;
  /** ISO string — check-in is conventionally 14:00 local */
  validFrom: string;
  /** ISO string — check-out is conventionally 12:00 local */
  validTo: string;
  status: "active" | "expired" | "revoked";
  ttlockPwdId?: string;
  createdAt: string;
}

export interface ICalConfig {
  id: string;
  propertyId: string;
  propertyName: string;
  channel: "airbnb" | "vrbo" | "booking" | "other";
  url: string;
  lastSync?: string;
  autoGeneratePins: boolean;
  /** Lock device that auto-generated PINs should be written to */
  targetDeviceId?: string;
  bookings?: ParsedICalBooking[];
}

export interface Integrations {
  tuya: {
    clientId: string;
    clientSecret: string;
    region: string;
    uid: string;
    accessToken?: string;
  };
  ttlock: {
    clientId: string;
    clientSecret: string;
    username: string;
    password: string;
    accessToken?: string;
  };
}

export interface DirectBooking {
  id: string;
  propertyId: string;
  propertyName: string;
  guestName: string;
  guestPhone?: string;
  checkin: string;
  checkout: string;
  status: string;
}

export interface Property {
  id: string;
  name: string;
  channels?: Array<{
    name: string;
    connected: boolean;
    icalUrl?: string;
  }>;
}
