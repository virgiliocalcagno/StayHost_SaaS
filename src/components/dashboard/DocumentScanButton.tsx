"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

// ─── Datos extraidos ───────────────────────────────────────────────────────
//
// Lo que el OCR intenta reconocer de un pasaporte o cedula. Todos los campos
// son opcionales — si el OCR no agarra algo, el host completa a mano.

export type ScannedDoc = {
  guestName?: string;
  docNumber?: string;
  nationality?: string;      // codigo ISO 3 letras (DOM, ESP, USA...)
  dateOfBirth?: string;      // YYYY-MM-DD
  expirationDate?: string;   // YYYY-MM-DD
  source: "passport-mrz" | "dominican-cedula" | "loose-text";
  rawText: string;           // para debug / edicion manual
};

type Props = {
  onScanned: (data: ScannedDoc) => void;
  className?: string;
};

// Codigo de pais ISO 3166-1 alpha-3 (devuelto por el parser MRZ) → nombre.
// Solo los mas comunes — si el codigo no esta aca devolvemos el codigo crudo.
const COUNTRY_NAMES: Record<string, string> = {
  DOM: "República Dominicana",
  USA: "Estados Unidos",
  ESP: "España",
  MEX: "México",
  COL: "Colombia",
  ARG: "Argentina",
  VEN: "Venezuela",
  BRA: "Brasil",
  CHL: "Chile",
  PER: "Perú",
  CUB: "Cuba",
  HTI: "Haití",
  CAN: "Canadá",
  FRA: "Francia",
  DEU: "Alemania",
  ITA: "Italia",
  GBR: "Reino Unido",
};

// Formato fecha MRZ (YYMMDD) → ISO (YYYY-MM-DD).
// Heuristica del siglo: si YY > 30 asumimos 19YY, si no 20YY. Funciona bien
// para pasaportes porque fechas de nacimiento de menores de 95 anios caen
// antes de 2030 y los recien nacidos tienen poco que escanear.
function mrzDateToIso(yyMmDd: string): string | undefined {
  if (!/^\d{6}$/.test(yyMmDd)) return undefined;
  const yy = parseInt(yyMmDd.slice(0, 2), 10);
  const mm = yyMmDd.slice(2, 4);
  const dd = yyMmDd.slice(4, 6);
  const fullYear = yy > 30 ? 1900 + yy : 2000 + yy;
  // Sanity: mes entre 01 y 12, dia entre 01 y 31.
  if (parseInt(mm, 10) < 1 || parseInt(mm, 10) > 12) return undefined;
  if (parseInt(dd, 10) < 1 || parseInt(dd, 10) > 31) return undefined;
  return `${fullYear}-${mm}-${dd}`;
}

// Limpia el nombre MRZ: "GOMEZ<<JUAN<CARLOS" → "Juan Carlos Gomez".
// Apellido va antes del doble <<, nombres despues separados por <.
function mrzNameToReadable(field: string): string {
  // field viene como "APELLIDO<<NOMBRE<SEGUNDO" o "APELLIDO APELLIDO2  NOMBRES"
  // Eliminamos los fillers '<' y normalizamos espacios.
  const clean = field.replace(/</g, " ").replace(/\s+/g, " ").trim();
  // Si tenemos apellido + nombres separados, los revertimos: nombres primero.
  // Heuristica: el parser `mrz` devuelve firstName y lastName por separado,
  // asi que normalmente no pasamos por aca — es fallback.
  return clean
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Normaliza ruido comun del OCR en la zona MRZ. Tesseract a veces lee
// '<' como '(' '{' '[' '|' '«' etc. El ICAO solo permite A-Z, 0-9, y '<'
// asi que todo lo que no sea eso lo convertimos a '<' si estamos en una
// linea larga con estructura de MRZ.
function normalizeMrzLine(line: string): string {
  return line
    .replace(/[«»{}()\[\]|¦\\/]/g, "<")
    .replace(/[^A-Z0-9<]/g, "<")
    .replace(/\s/g, "");
}

// Intenta parsear MRZ (pasaporte ICAO 9303). Devuelve campos si reconoce.
async function tryMrz(text: string): Promise<Partial<ScannedDoc> | null> {
  // Detectar candidatas: lineas largas (>=30 chars despues de quitar
  // espacios) que contengan al menos un caracter parecido a '<' o que
  // empiecen con tipos conocidos de MRZ (P<, I<, ID, etc).
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s/g, ""))
    .filter((l) => l.length >= 28);

  // Candidatas "con pinta de MRZ": probamos pares consecutivos.
  const candidatesPairs: string[][] = [];
  for (let i = 0; i < rawLines.length - 1; i++) {
    const a = normalizeMrzLine(rawLines[i].toUpperCase());
    const b = normalizeMrzLine(rawLines[i + 1].toUpperCase());
    // Descartar si ambas son puros '<' (ruido puro).
    if (a.replace(/</g, "").length < 5 || b.replace(/</g, "").length < 5) continue;
    // Probamos con longitudes 44 (tipo 3 = pasaporte) y 36 (tipo 2 = visa/id).
    const padTo = (s: string, n: number) =>
      s.length >= n ? s.slice(0, n) : s + "<".repeat(n - s.length);
    candidatesPairs.push([padTo(a, 44), padTo(b, 44)]);
    candidatesPairs.push([padTo(a, 36), padTo(b, 36)]);
  }
  // Tambien probamos 3 lineas consecutivas (IDs estilo TD1: 3x30 chars).
  const candidatesTriples: string[][] = [];
  for (let i = 0; i < rawLines.length - 2; i++) {
    const a = normalizeMrzLine(rawLines[i].toUpperCase());
    const b = normalizeMrzLine(rawLines[i + 1].toUpperCase());
    const c = normalizeMrzLine(rawLines[i + 2].toUpperCase());
    if ([a, b, c].every((s) => s.replace(/</g, "").length >= 5)) {
      const pad = (s: string) => (s.length >= 30 ? s.slice(0, 30) : s + "<".repeat(30 - s.length));
      candidatesTriples.push([pad(a), pad(b), pad(c)]);
    }
  }

  if (candidatesPairs.length === 0 && candidatesTriples.length === 0) return null;

  try {
    const mrzLib = await import("mrz");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parseFn = (mrzLib as any).parse as (input: string[]) => { valid?: boolean; fields?: Record<string, unknown> };

    const allCandidates = [...candidatesTriples, ...candidatesPairs];
    for (const cand of allCandidates) {
      try {
        const parsed = parseFn(cand);
        const fields = parsed?.fields;
        if (!fields) continue;
        // Requerimos al menos documentNumber para aceptar el parseo.
        if (!fields.documentNumber) continue;
        const firstName = (fields.firstName as string) ?? "";
        const lastName = (fields.lastName as string) ?? "";
        const fullName = `${firstName} ${lastName}`.trim().replace(/\s+/g, " ");
        const readableName = fullName
          ? fullName.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
          : undefined;
        return {
          guestName: readableName,
          docNumber: (fields.documentNumber as string) ?? undefined,
          nationality: (fields.nationality as string) ?? undefined,
          dateOfBirth: fields.birthDate ? mrzDateToIso(fields.birthDate as string) : undefined,
          expirationDate: fields.expirationDate
            ? mrzDateToIso(fields.expirationDate as string)
            : undefined,
          source: "passport-mrz",
        };
      } catch {
        // Intento con la proxima candidata.
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Corrige misreads tipicos del OCR en contextos donde esperamos digitos.
// Ej: "O" → "0", "I"/"l" → "1", "S" → "5", "B" → "8", "Z" → "2", "G" → "6".
// Lo aplicamos SOLO en secuencias que parecen ser el numero (rodeadas de
// otros digitos) para no destruir nombres.
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

// Intenta cedula dominicana. Formato oficial: "001-1234567-1" (3-7-1 digitos).
// Tolera:
//   - cualquier separador entre los grupos (.,-_·espacio)
//   - sin separador ("00112345671")
//   - digitos mal leidos (OCR: O→0, I→1, S→5, etc.) mientras la longitud
//     total cuadre a 11 digitos
function tryDominicanCedula(text: string): Partial<ScannedDoc> | null {
  // Busca primero con separadores flexibles.
  const withSepRegex = /(\d{3})[^\dA-Za-z]{0,3}(\d{7})[^\dA-Za-z]{0,3}(\d{1})(?!\d)/;
  let m = text.match(withSepRegex);
  let docNumber: string | null = null;
  if (m) {
    docNumber = `${m[1]}-${m[2]}-${m[3]}`;
  }

  // Fallback: 11 digitos pegados (se acepta con ruido alrededor).
  if (!docNumber) {
    const stickyRegex = /(?<![A-Za-z\d])(\d{11})(?![A-Za-z\d])/;
    m = text.match(stickyRegex);
    if (m) {
      docNumber = `${m[1].slice(0, 3)}-${m[1].slice(3, 10)}-${m[1].slice(10)}`;
    }
  }

  // Fallback mas agresivo: buscamos sub-cadenas de 11+ chars donde al
  // aplicar digitify(queden exactamente 11 digitos). Solo si no encontramos
  // antes, para no producir falsos positivos.
  if (!docNumber) {
    const tokens = text.split(/\s+/);
    for (const tok of tokens) {
      const d = digitify(tok);
      if (d.length === 11 && /^\d{11}$/.test(d)) {
        docNumber = `${d.slice(0, 3)}-${d.slice(3, 10)}-${d.slice(10)}`;
        break;
      }
    }
  }

  if (!docNumber) return null;

  // Buscamos nombre. En cedulas dominicanas aparece en mayusculas debajo
  // de "NOMBRES" o "APELLIDOS". Tomamos cualquier linea con 2+ palabras
  // todas en mayusculas.
  const guestName = extractCapsName(text);

  return {
    guestName,
    docNumber,
    nationality: "DOM",
    source: "dominican-cedula",
  };
}

// Busca un nombre en texto OCR genérico. Heuristica:
//   1. Lineas con 2+ palabras ALL CAPS (>=3 chars cada una) y sin digitos.
//   2. Si no, lineas Title Case con 2+ palabras.
//   3. Filtramos palabras tipicas de header (NOMBRES, APELLIDOS, CEDULA, etc.)
function extractCapsName(text: string): string | undefined {
  const blacklist = new Set([
    "NOMBRES", "APELLIDOS", "CEDULA", "CÉDULA", "IDENTIDAD",
    "NACIONALIDAD", "SEXO", "FECHA", "NACIMIENTO", "PASAPORTE",
    "PASSPORT", "REPUBLICA", "REPÚBLICA", "DOMINICANA", "ESTADOS",
    "UNIDOS", "TYPE", "CODE", "ISSUING", "COUNTRY", "NAME",
    "SURNAME", "GIVEN", "NAMES", "DATE", "BIRTH", "SEX",
    "JUNTA", "CENTRAL", "ELECTORAL", "DOCUMENTO", "DOCUMENT",
  ]);

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Intento 1: linea con 2+ palabras ALL CAPS, sin digitos.
  for (const line of lines) {
    if (/\d/.test(line)) continue;
    const words = line.split(/\s+/).filter((w) => w.length >= 3);
    if (words.length < 2) continue;
    // Todas en mayusculas (permitimos acentos y ñ).
    const allCaps = words.every((w) => /^[A-ZÁÉÍÓÚÜÑ]+$/.test(w));
    if (!allCaps) continue;
    // Que no sea todo blacklist.
    const meaningful = words.filter((w) => !blacklist.has(w));
    if (meaningful.length < 2) continue;
    return meaningful
      .join(" ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Intento 2: Title Case con 2+ palabras.
  for (const line of lines) {
    if (/\d/.test(line)) continue;
    const words = line.split(/\s+/).filter((w) => w.length >= 3);
    if (words.length < 2) continue;
    const titleCase = words.every((w) => /^[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+$/.test(w));
    if (titleCase) {
      return words.join(" ");
    }
  }

  return undefined;
}

// Ultimo recurso: al menos intenta extraer un nombre con la heuristica de
// mayusculas. Si encuentra algo, el host ve lo que pudimos leer y completa
// el resto a mano.
function looseText(text: string): Partial<ScannedDoc> {
  const guestName = extractCapsName(text);
  return { guestName, source: "loose-text" };
}

async function preprocessImage(file: File): Promise<HTMLCanvasElement> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = URL.createObjectURL(file);
  });
  // Resolucion mas alta (2200px) mejora MRZ significativamente — los '<'
  // son chars angostos que Tesseract confunde facil en baja resolucion.
  // Manejable por CPU de movil mid-range (3-8s para 2200x1600).
  const maxDim = 2200;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas context");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // B&N + contraste moderado. Evitamos binarizar porque destruye los
  // caracteres finos como '<' del MRZ.
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    // Contraste tipo S-curve: oscurece lo oscuro, clarea lo claro, deja
    // los tonos medios intactos.
    let adjusted: number;
    if (gray < 80) adjusted = Math.max(0, gray * 0.5);
    else if (gray > 180) adjusted = Math.min(255, gray * 1.15);
    else adjusted = gray;
    data[i] = data[i + 1] = data[i + 2] = adjusted;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

export default function DocumentScanButton({ onScanned, className }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleFile = async (file: File) => {
    setLoading(true);
    setProgress(0);
    try {
      const canvas = await preprocessImage(file);

      // Tesseract se importa dinamico (≈2MB + ≈10MB de datos spa/eng). Solo
      // se descarga la primera vez que el host aprieta "Escanear".
      const Tesseract = (await import("tesseract.js")).default;

      // Primera pasada: espanol general — mejor para cedulas con nombre
      // en espanol y campos tipo "NOMBRES", "APELLIDOS".
      const { data: dataGeneral } = await Tesseract.recognize(canvas, "spa", {
        logger: (m) => {
          if (m.status === "recognizing text" && typeof m.progress === "number") {
            setProgress(Math.round(m.progress * 50)); // 0-50%
          }
        },
      });
      const textGeneral = dataGeneral.text ?? "";

      // Segunda pasada: MRZ-mode. Tesseract con whitelist de chars ICAO
      // y PSM 6 (bloque unico de texto) da mucho mejor accuracy en la
      // zona MRZ al pie del pasaporte. Si la foto no tiene MRZ (ej.
      // cedula), esta pasada devuelve basura pero no molesta — solo la
      // usamos para el parser MRZ.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: dataMrz } = await (Tesseract as any).recognize(canvas, "eng", {
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
        tessedit_pageseg_mode: "6",
        logger: (m: { status?: string; progress?: number }) => {
          if (m.status === "recognizing text" && typeof m.progress === "number") {
            setProgress(50 + Math.round(m.progress * 50)); // 50-100%
          }
        },
      });
      const textMrz = (dataMrz as { text?: string }).text ?? "";

      // Combinamos el texto para parsers genericos (el MRZ-only tiene
      // menos contexto para nombres). Probamos MRZ sobre la version
      // MRZ-mode primero; si falla, fallback a cedula sobre general.
      const combinedText = `${textGeneral}\n---\n${textMrz}`;

      const mrz = (await tryMrz(textMrz)) ?? (await tryMrz(textGeneral));
      const cedula = !mrz ? tryDominicanCedula(textGeneral) : null;
      const loose = !mrz && !cedula ? looseText(textGeneral) : null;

      const source: ScannedDoc["source"] = mrz
        ? "passport-mrz"
        : cedula
          ? "dominican-cedula"
          : "loose-text";

      const result: ScannedDoc = {
        ...(mrz ?? cedula ?? loose!),
        rawText: combinedText,
        source,
      };

      const filledCount = [
        result.guestName,
        result.docNumber,
        result.nationality,
      ].filter(Boolean).length;

      if (filledCount === 0) {
        // Mostramos las primeras 120 chars del OCR para que el host vea
        // que Tesseract SI leyo texto pero los parsers no reconocieron
        // estructura — ayuda a debuggear si el problema es angulo, luz
        // o que mi parser es muy estricto.
        const preview = textGeneral.trim().slice(0, 120).replace(/\s+/g, " ");
        toast.warning(
          `No pude reconocer campos. OCR leyo: "${preview || "(vacio)"}". Intenta con mas luz o acerca mas el documento.`,
          { duration: 10000 },
        );
      } else {
        const natLabel = result.nationality
          ? COUNTRY_NAMES[result.nationality] ?? result.nationality
          : "?";
        const docType =
          result.source === "passport-mrz"
            ? "Pasaporte"
            : result.source === "dominican-cedula"
              ? "Cédula DOM"
              : "texto";
        toast.success(
          `${docType}: ${filledCount}/3 campos, nacionalidad ${natLabel}.${result.guestName ? ` ${result.guestName}` : ""}`,
          { duration: 5000 },
        );
      }

      onScanned(result);
    } catch (err) {
      toast.error(
        `Error leyendo el documento: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoading(false);
      setProgress(0);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <Button
        type="button"
        size="sm"
        disabled={loading}
        onClick={() => inputRef.current?.click()}
        className={className ?? "bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[11px] font-extrabold uppercase tracking-wider flex items-center gap-2 h-9 shadow-lg shadow-blue-500/20"}
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {progress > 0 ? `${progress}%` : "Leyendo..."}
          </>
        ) : (
          <>
            <Camera className="w-4 h-4" />
            ESCANEAR
          </>
        )}
      </Button>
    </>
  );
}
