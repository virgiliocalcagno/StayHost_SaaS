/**
 * Check-in API — /api/checkin
 * In-memory store (demo). Replace Map with Firebase Firestore in production.
 *
 * All requests are POST with { action, ...payload }
 * Actions:
 *   "create"          → create a new check-in record
 *   "get"             → get record by id
 *   "list"            → list all records
 *   "auth"            → verify guest (lastName + last4) → returns record if match
 *   "uploadId"        → store base64 ID photo, set idStatus="uploaded"
 *   "payElectricity"  → mark electricityPaid=true
 *   "validateId"      → host validates ID → idStatus="validated", accessGranted=true
 *   "rejectId"        → host rejects ID → idStatus="rejected"
 *   "delete"          → remove record
 */

import { NextRequest, NextResponse } from "next/server";

export interface CheckInRecord {
  id: string;
  guestName: string;
  guestLastName: string;     // used for auth
  lastFourDigits: string;    // used for auth
  checkin: string;           // YYYY-MM-DD
  checkout: string;          // YYYY-MM-DD
  nights: number;
  propertyId: string;
  propertyName: string;
  propertyAddress?: string;
  propertyImage?: string;
  wifiSsid?: string;
  wifiPassword?: string;
  electricityEnabled: boolean;
  electricityRate: number;   // USD per night (default 5)
  electricityPaid: boolean;
  electricityTotal: number;  // calculated
  paypalFeeIncluded: boolean;
  idPhotoBase64?: string;
  idStatus: "pending" | "uploaded" | "validated" | "rejected";
  accessGranted: boolean;
  status: "pendiente" | "validado";
  createdAt: string;
  updatedAt: string;
  bookingRef?: string;       // link to stayhost_direct_bookings id
}

// In-memory store — module-level singleton (persists within a process lifetime)
// NOTE: In production, swap this Map for a Firestore collection.
const store = new Map<string, CheckInRecord>();

function now() { return new Date().toISOString(); }

function calcElectricity(nights: number, rate: number, includePaypal: boolean): number {
  const subtotal = nights * rate;
  return includePaypal ? parseFloat((subtotal / 0.943).toFixed(2)) : subtotal;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const { action, ...data } = body;

    switch (action) {

      case "create": {
        const id = `ci-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const nights = data.nights as number ?? 1;
        const rate = (data.electricityRate as number) ?? 5;
        const paypal = (data.paypalFeeIncluded as boolean) ?? true;
        const record: CheckInRecord = {
          id,
          guestName: String(data.guestName ?? ""),
          guestLastName: String(data.guestLastName ?? "").toLowerCase().trim(),
          lastFourDigits: String(data.lastFourDigits ?? ""),
          checkin: String(data.checkin ?? ""),
          checkout: String(data.checkout ?? ""),
          nights,
          propertyId: String(data.propertyId ?? ""),
          propertyName: String(data.propertyName ?? ""),
          propertyAddress: data.propertyAddress ? String(data.propertyAddress) : undefined,
          propertyImage: data.propertyImage ? String(data.propertyImage) : undefined,
          wifiSsid: data.wifiSsid ? String(data.wifiSsid) : undefined,
          wifiPassword: data.wifiPassword ? String(data.wifiPassword) : undefined,
          electricityEnabled: (data.electricityEnabled as boolean) ?? true,
          electricityRate: rate,
          electricityPaid: false,
          electricityTotal: calcElectricity(nights, rate, paypal),
          paypalFeeIncluded: paypal,
          idStatus: "pending",
          accessGranted: false,
          status: "pendiente",
          createdAt: now(),
          updatedAt: now(),
          bookingRef: data.bookingRef ? String(data.bookingRef) : undefined,
        };
        store.set(id, record);
        return NextResponse.json({ success: true, id, record });
      }

      case "get": {
        const id = String(data.id ?? "");
        const record = store.get(id);
        if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
        // Never expose WiFi/password in unauthenticated get
        const safe = { ...record, wifiPassword: record.accessGranted ? record.wifiPassword : undefined };
        return NextResponse.json({ record: safe });
      }

      case "list": {
        const records = Array.from(store.values()).sort(
          (a, b) => a.checkin.localeCompare(b.checkin)
        );
        return NextResponse.json({ records });
      }

      case "auth": {
        const id = String(data.id ?? "");
        const lastName = String(data.lastName ?? "").toLowerCase().trim();
        const last4 = String(data.last4 ?? "").trim();
        const record = store.get(id);
        if (!record) return NextResponse.json({ error: "Reservación no encontrada" }, { status: 404 });
        if (record.guestLastName !== lastName || record.lastFourDigits !== last4) {
          return NextResponse.json({ error: "Datos incorrectos. Verifica tu apellido y los últimos 4 dígitos de tu teléfono." }, { status: 401 });
        }
        return NextResponse.json({ success: true, record });
      }

      case "uploadId": {
        const id = String(data.id ?? "");
        const record = store.get(id);
        if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
        const photo = String(data.idPhotoBase64 ?? "");
        // Rough size guard: base64 of 8MB = ~10.9MB string
        if (photo.length > 11_000_000) {
          return NextResponse.json({ error: "Imagen demasiado grande (máx 8MB)" }, { status: 413 });
        }
        const updated = { ...record, idPhotoBase64: photo, idStatus: "uploaded" as const, updatedAt: now() };
        store.set(id, updated);
        return NextResponse.json({ success: true });
      }

      case "payElectricity": {
        const id = String(data.id ?? "");
        const record = store.get(id);
        if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
        const updated = { ...record, electricityPaid: true, updatedAt: now() };
        // Auto-grant access if ID already validated
        if (record.idStatus === "validated") {
          updated.accessGranted = true;
          updated.status = "validado";
        }
        store.set(id, updated);
        return NextResponse.json({ success: true, accessGranted: updated.accessGranted, record: updated });
      }

      case "validateId": {
        const id = String(data.id ?? "");
        const record = store.get(id);
        if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
        const electricityOk = !record.electricityEnabled || record.electricityPaid;
        const updated = {
          ...record,
          idStatus: "validated" as const,
          accessGranted: electricityOk,
          status: electricityOk ? ("validado" as const) : ("pendiente" as const),
          updatedAt: now(),
        };
        store.set(id, updated);
        return NextResponse.json({ success: true, record: updated });
      }

      case "rejectId": {
        const id = String(data.id ?? "");
        const record = store.get(id);
        if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
        const updated = { ...record, idStatus: "rejected" as const, accessGranted: false, updatedAt: now() };
        store.set(id, updated);
        return NextResponse.json({ success: true });
      }

      case "update": {
        const id = String(data.id ?? "");
        const record = store.get(id);
        if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
        const nights = (data.nights as number) ?? record.nights;
        const rate = (data.electricityRate as number) ?? record.electricityRate;
        const paypal = (data.paypalFeeIncluded as boolean) ?? record.paypalFeeIncluded;
        const updated = {
          ...record,
          ...data,
          id,
          nights,
          electricityRate: rate,
          electricityTotal: calcElectricity(nights, rate, paypal),
          paypalFeeIncluded: paypal,
          updatedAt: now(),
        } as CheckInRecord;
        store.set(id, updated);
        return NextResponse.json({ success: true, record: updated });
      }

      case "delete": {
        const id = String(data.id ?? "");
        store.delete(id);
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
