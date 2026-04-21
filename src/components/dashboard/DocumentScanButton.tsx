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

// Intenta parsear MRZ (pasaporte ICAO 9303). Devuelve campos si reconoce.
async function tryMrz(text: string): Promise<Partial<ScannedDoc> | null> {
  // Busca 2 o 3 lineas consecutivas de ~44 chars con muchos '<'.
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s/g, ""))
    .filter((l) => l.length >= 30 && l.length <= 50 && l.includes("<"));

  if (lines.length < 2) return null;

  // Algunas veces Tesseract mete ruido adelante. Tomamos las ultimas dos.
  const candidate = lines.slice(-2);

  try {
    const mrzLib = await import("mrz");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = (mrzLib as any).parse(candidate);
    if (!parsed?.valid && !parsed?.fields) return null;
    const f = parsed.fields;
    const firstName = f.firstName ?? "";
    const lastName = f.lastName ?? "";
    const fullName = `${firstName} ${lastName}`.trim().replace(/\s+/g, " ");
    const readableName = fullName
      ? fullName.toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase())
      : undefined;

    return {
      guestName: readableName,
      docNumber: f.documentNumber ?? undefined,
      nationality: f.nationality ?? undefined,
      dateOfBirth: f.birthDate ? mrzDateToIso(f.birthDate) : undefined,
      expirationDate: f.expirationDate ? mrzDateToIso(f.expirationDate) : undefined,
      source: "passport-mrz",
    };
  } catch {
    return null;
  }
}

// Intenta cedula dominicana: formato "001-1234567-1" o "001 1234567 1" o
// "00112345671" (sin separadores). Ademas busca un nombre en las proximas
// lineas.
function tryDominicanCedula(text: string): Partial<ScannedDoc> | null {
  const cedulaRegex = /\b(\d{3})[-\s]?(\d{7})[-\s]?(\d{1})\b/;
  const m = text.match(cedulaRegex);
  if (!m) return null;
  const docNumber = `${m[1]}-${m[2]}-${m[3]}`;

  // El nombre suele estar en mayusculas despues de la palabra "NOMBRES" o
  // en una linea cercana. Tomamos la primera linea con >1 palabra en
  // mayusculas que no tenga digitos.
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const nameLine = lines.find((l) =>
    !/\d/.test(l) &&
    /^[A-ZÁÉÍÓÚÑ ]{5,}$/.test(l) &&
    l.split(/\s+/).length >= 2,
  );
  const guestName = nameLine
    ? nameLine.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    : undefined;

  return {
    guestName,
    docNumber,
    nationality: "DOM",
    source: "dominican-cedula",
  };
}

// Ultimo recurso: si no identificamos estructura, devolvemos el texto crudo
// para que el host lo use de referencia visual. Los campos quedan vacios.
function looseText(text: string): Partial<ScannedDoc> {
  return { source: "loose-text" };
}

async function preprocessImage(file: File): Promise<HTMLCanvasElement> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = URL.createObjectURL(file);
  });
  // Limitar tamaño max 1600px para que Tesseract no se quede quieto con
  // fotos de 4000x3000.
  const maxDim = 1600;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas context");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // Aumentar contraste + B&N para mejorar accuracy del OCR.
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    // Simple threshold con rango suave (no binario, para que MRZ mantenga
    // los '<' legibles).
    const adjusted = gray < 120 ? Math.max(0, gray - 20) : Math.min(255, gray + 30);
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
      const { data } = await Tesseract.recognize(canvas, "spa+eng", {
        logger: (m) => {
          if (m.status === "recognizing text" && typeof m.progress === "number") {
            setProgress(Math.round(m.progress * 100));
          }
        },
      });

      const text = data.text ?? "";

      // Probamos parsers en orden de confianza.
      const mrz = await tryMrz(text);
      const cedula = !mrz ? tryDominicanCedula(text) : null;
      const loose = !mrz && !cedula ? looseText(text) : null;

      const result: ScannedDoc = {
        ...(mrz ?? cedula ?? loose!),
        rawText: text,
        source: (mrz ? "passport-mrz" : cedula ? "dominican-cedula" : "loose-text") as ScannedDoc["source"],
      };

      const filledCount = [
        result.guestName,
        result.docNumber,
        result.nationality,
      ].filter(Boolean).length;

      if (filledCount === 0) {
        toast.warning(
          "No pude reconocer el documento. Intenta con mejor luz, sin reflejos, y que la foto no este movida.",
          { duration: 6000 },
        );
      } else {
        const natLabel = result.nationality
          ? COUNTRY_NAMES[result.nationality] ?? result.nationality
          : "?";
        toast.success(
          `Documento leido (${result.source === "passport-mrz" ? "Pasaporte" : result.source === "dominican-cedula" ? "Cédula DOM" : "texto"}). ${filledCount}/3 campos, nacionalidad: ${natLabel}.`,
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
