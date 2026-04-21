/**
 * Parsers de texto OCR → campos estructurados.
 *
 * Se usan server-side en /api/ocr/scan-document. El input es el texto
 * crudo que devuelve OCR.space (ya decentemente preprocesado). Probamos
 * 3 estrategias en orden: MRZ de pasaporte, cedula dominicana, texto
 * suelto (con extraccion generica de nombres).
 */

export type ScannedDoc = {
  guestName?: string;
  docNumber?: string;
  nationality?: string;      // ISO alpha-3 (DOM, ESP, USA...)
  dateOfBirth?: string;      // YYYY-MM-DD
  expirationDate?: string;   // YYYY-MM-DD
  source: "passport-mrz" | "dominican-cedula" | "loose-text";
  rawText: string;
};

// ── helpers ─────────────────────────────────────────────────────────────

function mrzDateToIso(yyMmDd: string): string | undefined {
  if (!/^\d{6}$/.test(yyMmDd)) return undefined;
  const yy = parseInt(yyMmDd.slice(0, 2), 10);
  const mm = yyMmDd.slice(2, 4);
  const dd = yyMmDd.slice(4, 6);
  const fullYear = yy > 30 ? 1900 + yy : 2000 + yy;
  if (parseInt(mm, 10) < 1 || parseInt(mm, 10) > 12) return undefined;
  if (parseInt(dd, 10) < 1 || parseInt(dd, 10) > 31) return undefined;
  return `${fullYear}-${mm}-${dd}`;
}

function normalizeMrzLine(line: string): string {
  return line
    .replace(/[«»{}()\[\]|¦\\/]/g, "<")
    .replace(/[^A-Z0-9<]/g, "<")
    .replace(/\s/g, "");
}

function digitify(s: string): string {
  return s
    .replace(/O/gi, "0")
    .replace(/[Il|]/g, "1")
    .replace(/S/g, "5")
    .replace(/B/g, "8")
    .replace(/Z/g, "2")
    .replace(/G/g, "6")
    .replace(/[^0-9]/g, "");
}

// Nombre como Title Case respetando acentos. "JUAN CARLOS GOMEZ" → "Juan Carlos Gomez".
function toReadableName(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── MRZ (pasaporte) ─────────────────────────────────────────────────────

async function tryMrz(text: string): Promise<Partial<ScannedDoc> | null> {
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s/g, ""))
    .filter((l) => l.length >= 28);

  const candidatesPairs: string[][] = [];
  for (let i = 0; i < rawLines.length - 1; i++) {
    const a = normalizeMrzLine(rawLines[i].toUpperCase());
    const b = normalizeMrzLine(rawLines[i + 1].toUpperCase());
    if (a.replace(/</g, "").length < 5 || b.replace(/</g, "").length < 5) continue;
    const padTo = (s: string, n: number) =>
      s.length >= n ? s.slice(0, n) : s + "<".repeat(n - s.length);
    candidatesPairs.push([padTo(a, 44), padTo(b, 44)]);
    candidatesPairs.push([padTo(a, 36), padTo(b, 36)]);
  }
  const candidatesTriples: string[][] = [];
  for (let i = 0; i < rawLines.length - 2; i++) {
    const a = normalizeMrzLine(rawLines[i].toUpperCase());
    const b = normalizeMrzLine(rawLines[i + 1].toUpperCase());
    const c = normalizeMrzLine(rawLines[i + 2].toUpperCase());
    if ([a, b, c].every((s) => s.replace(/</g, "").length >= 5)) {
      const pad = (s: string) =>
        s.length >= 30 ? s.slice(0, 30) : s + "<".repeat(30 - s.length);
      candidatesTriples.push([pad(a), pad(b), pad(c)]);
    }
  }

  if (candidatesPairs.length === 0 && candidatesTriples.length === 0) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mrzLib: any = await import("mrz");
    const parseFn = mrzLib.parse as (input: string[]) => {
      valid?: boolean;
      fields?: Record<string, unknown>;
    };

    for (const cand of [...candidatesTriples, ...candidatesPairs]) {
      try {
        const parsed = parseFn(cand);
        const fields = parsed?.fields;
        if (!fields || !fields.documentNumber) continue;
        const firstName = (fields.firstName as string) ?? "";
        const lastName = (fields.lastName as string) ?? "";
        const fullName = `${firstName} ${lastName}`.trim().replace(/\s+/g, " ");
        return {
          guestName: fullName ? toReadableName(fullName) : undefined,
          docNumber: (fields.documentNumber as string) ?? undefined,
          nationality: (fields.nationality as string) ?? undefined,
          dateOfBirth: fields.birthDate
            ? mrzDateToIso(fields.birthDate as string)
            : undefined,
          expirationDate: fields.expirationDate
            ? mrzDateToIso(fields.expirationDate as string)
            : undefined,
          source: "passport-mrz",
        };
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Cedula Dominicana ───────────────────────────────────────────────────

function tryDominicanCedula(text: string): Partial<ScannedDoc> | null {
  let docNumber: string | null = null;

  const withSepRegex = /(\d{3})[^\dA-Za-z]{0,3}(\d{7})[^\dA-Za-z]{0,3}(\d{1})(?!\d)/;
  let m = text.match(withSepRegex);
  if (m) docNumber = `${m[1]}-${m[2]}-${m[3]}`;

  if (!docNumber) {
    const stickyRegex = /(?<![A-Za-z\d])(\d{11})(?![A-Za-z\d])/;
    m = text.match(stickyRegex);
    if (m) docNumber = `${m[1].slice(0, 3)}-${m[1].slice(3, 10)}-${m[1].slice(10)}`;
  }

  if (!docNumber) {
    for (const tok of text.split(/\s+/)) {
      const d = digitify(tok);
      if (d.length === 11 && /^\d{11}$/.test(d)) {
        docNumber = `${d.slice(0, 3)}-${d.slice(3, 10)}-${d.slice(10)}`;
        break;
      }
    }
  }

  if (!docNumber) return null;
  return {
    guestName: extractCapsName(text),
    docNumber,
    nationality: "DOM",
    source: "dominican-cedula",
  };
}

// ── Extraccion generica de nombre ───────────────────────────────────────

const NAME_BLACKLIST = new Set([
  "NOMBRES", "APELLIDOS", "CEDULA", "CÉDULA", "IDENTIDAD",
  "NACIONALIDAD", "SEXO", "FECHA", "NACIMIENTO", "PASAPORTE",
  "PASSPORT", "REPUBLICA", "REPÚBLICA", "DOMINICANA", "ESTADOS",
  "UNIDOS", "TYPE", "CODE", "ISSUING", "COUNTRY", "NAME", "SURNAME",
  "GIVEN", "NAMES", "DATE", "BIRTH", "SEX", "JUNTA", "CENTRAL",
  "ELECTORAL", "DOCUMENTO", "DOCUMENT", "AUTHORITY", "EXPEDICION",
  "VENCIMIENTO", "VALIDO", "VALID", "EXPIRA", "BORN", "ISSUE",
  "ISSUED", "GENDER", "SIGNATURE", "FIRMA",
]);

export function extractCapsName(text: string): string | undefined {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Pasada 1: linea ALL CAPS con 2+ palabras significativas.
  for (const line of lines) {
    if (/\d/.test(line)) continue;
    const words = line.split(/\s+/).filter((w) => w.length >= 3);
    if (words.length < 2) continue;
    const allCaps = words.every((w) => /^[A-ZÁÉÍÓÚÜÑ]+$/.test(w));
    if (!allCaps) continue;
    const meaningful = words.filter((w) => !NAME_BLACKLIST.has(w));
    if (meaningful.length < 2) continue;
    return toReadableName(meaningful.join(" "));
  }

  // Pasada 2: Title Case.
  for (const line of lines) {
    if (/\d/.test(line)) continue;
    const words = line.split(/\s+/).filter((w) => w.length >= 3);
    if (words.length < 2) continue;
    if (words.every((w) => /^[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+$/.test(w))) {
      return words.join(" ");
    }
  }

  return undefined;
}

// ── Entry point ─────────────────────────────────────────────────────────

export async function parseDocumentText(rawText: string): Promise<ScannedDoc> {
  const mrz = await tryMrz(rawText);
  if (mrz) return { ...mrz, rawText, source: "passport-mrz" };

  const cedula = tryDominicanCedula(rawText);
  if (cedula) return { ...cedula, rawText, source: "dominican-cedula" };

  return {
    guestName: extractCapsName(rawText),
    source: "loose-text",
    rawText,
  };
}
