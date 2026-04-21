"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";

// El shape que devuelve /api/ocr/scan-document. Los parsers viven en el
// server (src/lib/ocr/parsers.ts), aca solo consumimos el resultado.
export type ScannedDoc = {
  guestName?: string;
  docNumber?: string;
  nationality?: string;
  dateOfBirth?: string;
  expirationDate?: string;
  source: "gemini";
  rawText: string;
};

type Props = {
  onScanned: (data: ScannedDoc) => void;
  className?: string;
};

// Codigos ISO 3 letras → nombre amigable para el toast.
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

// Reduce la imagen a <=1MB (limite del plan free de OCR.space) antes de
// subir. Tambien fija el lado mayor en 1800px — mas que eso no mejora OCR
// y si duplica la subida.
async function compressImage(file: File): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = URL.createObjectURL(file);
  });

  const maxDim = 1800;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas 2D context");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // Intentamos JPEG con quality decreciente hasta quedar bajo 1MB.
  const qualities = [0.9, 0.8, 0.7, 0.6];
  for (const q of qualities) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", q),
    );
    if (blob && blob.size <= 1024 * 1024) return blob;
    if (blob && q === qualities[qualities.length - 1]) return blob; // ultimo intento
  }
  throw new Error("No se pudo comprimir la imagen");
}

export default function DocumentScanButton({ onScanned, className }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFile = async (file: File) => {
    setLoading(true);
    try {
      const compressed = await compressImage(file);
      const form = new FormData();
      form.append("image", compressed, "scan.jpg");

      const res = await fetch("/api/ocr/scan-document", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        toast.error(err.error ?? "Error desconocido al escanear", { duration: 8000 });
        return;
      }

      const { doc } = (await res.json()) as { doc: ScannedDoc };
      const filled = [doc.guestName, doc.docNumber, doc.nationality].filter(Boolean).length;

      // Abrimos una ventana con el raw text siempre que pidamos diagnostico.
      // Asi podemos copiarlo y pegarlo en el chat para que yo ajuste parsers.
      const openRawWindow = () => {
        const w = window.open("", "_blank", "width=600,height=700");
        if (!w) return;
        w.document.write(
          `<pre style="font:12px monospace;padding:16px;white-space:pre-wrap">${(doc.rawText ?? "(vacio)").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!))}</pre>`,
        );
      };

      if (filled === 0) {
        const preview = (doc.rawText ?? "").trim().slice(0, 150).replace(/\s+/g, " ");
        toast.warning(
          preview
            ? `OCR no pudo parsear campos. Leyó: "${preview}..." — Click aca para ver texto completo`
            : "OCR no detectó texto. Intentá con mejor luz/foco.",
          { duration: 15000, action: { label: "Ver OCR", onClick: openRawWindow } },
        );
      } else {
        const natLabel = doc.nationality
          ? COUNTRY_NAMES[doc.nationality] ?? doc.nationality
          : "?";
        toast.success(
          `${filled}/3 campos.${doc.guestName ? ` ${doc.guestName}.` : ""} Nac: ${natLabel}`,
          {
            duration: 8000,
            action: { label: "Ver respuesta", onClick: openRawWindow },
          },
        );
      }

      onScanned(doc);
    } catch (err) {
      toast.error(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        { duration: 6000 },
      );
    } finally {
      setLoading(false);
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
        className={
          className ??
          "bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[11px] font-extrabold uppercase tracking-wider flex items-center gap-2 h-9 shadow-lg shadow-blue-500/20"
        }
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            ESCANEANDO...
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
