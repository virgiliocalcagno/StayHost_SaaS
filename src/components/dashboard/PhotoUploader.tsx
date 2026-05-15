"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Upload, X, Loader2 } from "lucide-react";
import { compressImageToWebp } from "@/lib/images/compress";
import { supabase } from "@/lib/supabase/client";

// Uploader reusable para fotos de upsells/vendors.
//
// Props mínimas para que el caller solo le diga:
//   - path: prefijo dentro del bucket (sin filename). Ej:
//     "<tenant_id>/upsell/<upsell_id>" o "<tenant_id>/vendor/<vendor_id>"
//   - photoUrl actual y onChange para que el caller persista la URL final.
//
// El bucket es público — devolvemos public URL, no signed URL.
// RLS path-based ya garantiza que solo el dueño del tenant escribe en su path.

interface PhotoUploaderProps {
  /** Prefijo dentro del bucket. Ej: "tenant_uuid/upsell/upsell_uuid". */
  pathPrefix: string;
  /** URL actual de la foto. Null = sin foto. */
  value: string | null;
  onChange: (newUrl: string | null) => void;
  /** Etiqueta del botón de upload (ej: "Foto principal"). */
  label?: string;
  /** Hint para el usuario (debajo del thumbnail). */
  hint?: string;
}

const BUCKET = "upsell-photos";

export default function PhotoUploader({
  pathPrefix,
  value,
  onChange,
  label = "Foto",
  hint,
}: PhotoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePick = () => {
    inputRef.current?.click();
  };

  // Extrae el path interno del bucket desde una URL pública. Devuelve null
  // si la URL no pertenece a este bucket (URL externa, otra ruta, etc.).
  const pathFromUrl = (url: string): string | null => {
    try {
      const u = new URL(url);
      const marker = `/${BUCKET}/`;
      const idx = u.pathname.indexOf(marker);
      if (idx < 0) return null;
      return u.pathname.slice(idx + marker.length);
    } catch {
      return null;
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);

    try {
      // 1. Comprimir a WebP en cliente. Reduce 60-80% el peso antes de subir.
      //    iPhones de turistas suben HEIC: el createImageBitmap puede fallar
      //    o no estar disponible. Fallback: subir original si pesa menos
      //    del límite del bucket (2MB). Si pesa más, error claro.
      let toUpload: File;
      try {
        toUpload = await compressImageToWebp(file);
      } catch {
        if (file.size > 2 * 1024 * 1024) {
          throw new Error(
            "Tu navegador no soporta compresión y la foto pesa más de 2MB. Convertí a JPEG/WebP antes de subir.",
          );
        }
        toUpload = file;
      }

      // 2. Path único dentro del prefix. Timestamp para evitar colisión.
      const filename = `${Date.now()}-${toUpload.name}`;
      const path = `${pathPrefix}/${filename}`;

      // 3. Subir directamente desde el browser. RLS path-based en el bucket
      //    enforce que el primer segmento del path sea el tenant del caller.
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, toUpload, {
          cacheControl: "31536000", // 1 año — las fotos son inmutables
          upsert: false,
        });
      if (upErr) {
        throw upErr;
      }

      // 4. URL pública. Bucket es public así que devolvemos URL directa.
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
      const newUrl = data.publicUrl;

      // 5. Cleanup: si había una foto anterior en este bucket, borrarla
      //    para no acumular huérfanos cada vez que el host usa "Cambiar".
      //    Best-effort — si falla, dejamos la huérfana sin romper la UX.
      if (value) {
        const oldPath = pathFromUrl(value);
        if (oldPath) {
          await supabase.storage.from(BUCKET).remove([oldPath]).catch(() => {});
        }
      }

      onChange(newUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error subiendo foto");
    } finally {
      setUploading(false);
      // Limpio el value del input para que onChange dispare aún si el user
      // elige el mismo archivo de nuevo.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleRemove = async () => {
    if (!value) return;
    // Best-effort: borrar el archivo si pertenece a este bucket. Si falla
    // o la URL no es nuestra, igualmente removemos la referencia.
    const path = pathFromUrl(value);
    if (path) {
      await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    }
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        // HEIC/HEIF: formato nativo de iPhone — el picker de iOS los muestra
        // aun sin estar en accept, pero los aceptamos explícitamente para
        // que el handleFile pueda detectarlos y dar fallback decente.
        accept="image/webp,image/jpeg,image/png,image/heic,image/heif"
        onChange={handleFile}
        className="hidden"
      />

      {value ? (
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt={label}
            className="h-32 w-32 object-cover rounded-xl border bg-muted"
          />
          <button
            type="button"
            onClick={handleRemove}
            className="absolute -top-2 -right-2 h-7 w-7 rounded-full bg-destructive text-white shadow-md flex items-center justify-center hover:scale-110 transition-transform"
            title="Quitar foto"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handlePick}
          disabled={uploading}
          className="h-32 w-32 rounded-xl border-2 border-dashed bg-muted/30 hover:bg-muted/60 transition-colors flex flex-col items-center justify-center gap-1 text-muted-foreground"
        >
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <>
              <Camera className="h-6 w-6" />
              <span className="text-[10px] font-medium">{label}</span>
            </>
          )}
        </button>
      )}

      {value && !uploading && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handlePick}
          className="text-xs h-7"
        >
          <Upload className="h-3 w-3 mr-1" /> Cambiar
        </Button>
      )}

      {hint && !error && (
        <p className="text-[10px] text-muted-foreground">{hint}</p>
      )}
      {error && (
        <p className="text-[11px] text-red-600">{error}</p>
      )}
    </div>
  );
}
