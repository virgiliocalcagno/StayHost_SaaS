/**
 * iCal Parser — StayHost
 * Parses Airbnb / VRBO / Booking .ics feeds
 * Extracts guest name, checkin, checkout, and phone last 4 digits.
 */

export interface ParsedICalBooking {
  uid: string;
  guestName: string;
  checkin: string;       // "YYYY-MM-DD"
  checkout: string;      // "YYYY-MM-DD"
  nights: number;
  phoneLast4?: string;   // Last 4 digits of guest phone (Airbnb provides this)
  channel: "airbnb" | "vrbo" | "booking" | "other";
  rawSummary: string;
  rawDescription: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function icalDateToISO(raw: string): string {
  // Handles: 20260510, 20260510T120000Z, 20260510T120000
  const digits = raw.replace(/[TZ]/g, "").slice(0, 8);
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function diffNights(from: string, to: string): number {
  const d1 = new Date(from).getTime();
  const d2 = new Date(to).getTime();
  return Math.max(0, Math.round((d2 - d1) / 86400000));
}

/** Extract property value from an iCal line like "DTSTART;VALUE=DATE:20260510" */
function extractValue(line: string): string {
  const colonIdx = line.indexOf(":");
  return colonIdx >= 0 ? line.slice(colonIdx + 1).trim() : "";
}

/** Unescape iCal text: \n → newline, \, → comma */
function unescapeIcal(text: string): string {
  return text
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/** Detect channel from iCal PRODID or URL content */
function detectChannel(icalText: string, url: string): "airbnb" | "vrbo" | "booking" | "other" {
  const lower = (icalText + url).toLowerCase();
  if (lower.includes("airbnb")) return "airbnb";
  if (lower.includes("vrbo") || lower.includes("homeaway")) return "vrbo";
  if (lower.includes("booking.com") || lower.includes("bookingcom")) return "booking";
  return "other";
}

/**
 * Extract last 4 phone digits from description.
 * Airbnb format: "Phone Number (Last 4 Digits): 5678"
 * VRBO format: "Phone: ...5678" or embedded in text
 */
function extractPhoneLast4(description: string): string | undefined {
  // Airbnb primary format
  let m = description.match(/Phone\s+Number\s*\(Last\s+4\s+Digits?\)\s*:\s*(\d{4})/i);
  if (m) return m[1];

  // Airbnb alternate: "Last 4 digits: 5678"
  m = description.match(/Last\s+4\s+digits?\s*:?\s*(\d{4})/i);
  if (m) return m[1];

  // VRBO: "Phone: xxx-xxx-5678" → grab last 4
  m = description.match(/Phone\s*:.*?(\d{4})(?:\s|$)/i);
  if (m) return m[1];

  // Generic: any 4-digit group labeled as phone
  m = description.match(/(?:Tel|Teléfono|Telefono|Cell|Mobile)\s*:?\s*[\+\d\s\-()]*?(\d{4})(?:\s|$)/i);
  if (m) return m[1];

  return undefined;
}

/** Clean guest name from summary (remove channel noise like "(Not available)" etc.) */
function cleanGuestName(summary: string): string {
  return summary
    .replace(/\(Not available\)/gi, "")
    .replace(/\(Reservación\)/gi, "")
    .replace(/\(Blocked\)/gi, "")
    .replace(/VRBO:\s*/i, "")
    .replace(/Airbnb\s*-?\s*/i, "")
    .trim() || "Huésped";
}

// ─── Main Parser ───────────────────────────────────────────────────────────────

export function parseICalFeed(icalText: string, url = ""): ParsedICalBooking[] {
  const channel = detectChannel(icalText, url);
  const bookings: ParsedICalBooking[] = [];

  // Split into VEVENT blocks
  const vevents = icalText.split("BEGIN:VEVENT").slice(1);

  for (const block of vevents) {
    const endIdx = block.indexOf("END:VEVENT");
    const content = endIdx >= 0 ? block.slice(0, endIdx) : block;

    // Unfold lines (iCal wraps long lines with CRLF + whitespace)
    const unfolded = content.replace(/\r?\n[ \t]/g, "");
    const lines = unfolded.split(/\r?\n/);

    const props: Record<string, string> = {};
    for (const line of lines) {
      const key = line.split(":")[0].split(";")[0].toUpperCase();
      if (key) props[key] = extractValue(line);
    }

    const uid = props["UID"] ?? `uid-${Math.random()}`;
    const rawSummary = unescapeIcal(props["SUMMARY"] ?? "");
    const rawDescription = unescapeIcal(props["DESCRIPTION"] ?? "");
    const dtstart = props["DTSTART"] ?? props["DTSTART;VALUE=DATE"] ?? "";
    const dtend = props["DTEND"] ?? props["DTEND;VALUE=DATE"] ?? "";

    if (!dtstart || !dtend) continue;

    // Skip blocked/maintenance entries (no real guest)
    if (/Not available|Blocked|Airbnb \(Not|Maintenance|Bloqueado/i.test(rawSummary)) continue;

    const checkin = icalDateToISO(dtstart);
    const checkout = icalDateToISO(dtend);
    const nights = diffNights(checkin, checkout);

    if (nights <= 0) continue;

    bookings.push({
      uid,
      guestName: cleanGuestName(rawSummary),
      checkin,
      checkout,
      nights,
      phoneLast4: extractPhoneLast4(rawDescription),
      channel,
      rawSummary,
      rawDescription,
    });
  }

  // Sort by checkin date
  return bookings.sort((a, b) => a.checkin.localeCompare(b.checkin));
}
