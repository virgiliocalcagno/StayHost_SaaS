/**
 * iCal Proxy — /api/ical
 * Fetches an iCal URL server-side to avoid CORS issues.
 * POST { url: string } → { ical: string }
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json() as { url: string };

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "URL requerida" }, { status: 400 });
    }

    // Allow only ical-type URLs for safety
    const allowed = ["airbnb.com", "vrbo.com", "homeaway.com", "booking.com", "google.com/calendar"];
    const isAllowed = allowed.some(domain => url.includes(domain)) || url.endsWith(".ics");
    if (!isAllowed) {
      return NextResponse.json({ error: "Dominio no permitido" }, { status: 403 });
    }

    const res = await fetch(url, {
      headers: { "User-Agent": "StayHost/1.0 iCal-Sync" },
      next: { revalidate: 300 }, // Cache 5 min
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Error fetching iCal: ${res.status}` }, { status: 502 });
    }

    const ical = await res.text();
    return NextResponse.json({ ical });
  } catch (err) {
    return NextResponse.json({ error: "Error interno", detail: String(err) }, { status: 500 });
  }
}
