// Compresión client-side de imágenes antes de upload.
//
// Pipeline:
//   1. Leer archivo a Image bitmap
//   2. Redimensionar a maxWidth (mantiene aspect ratio)
//   3. Renderizar en canvas
//   4. Exportar como WebP con calidad ajustable
//
// Por qué WebP: 60-80% menos peso que JPEG con calidad similar. El bucket
// tiene límite 2MB — sin compresión un IMG_xxxx.jpg de iPhone (3-8MB) lo
// rebotaría. Con WebP @ 0.85 quality + 1600px max ancho, terminamos en
// ~150-400KB típico — sobrado.

const DEFAULT_MAX_WIDTH = 1600;
const DEFAULT_QUALITY = 0.85;

export interface CompressOptions {
  maxWidth?: number;
  quality?: number; // 0..1
}

export async function compressImageToWebp(
  file: File,
  opts: CompressOptions = {},
): Promise<File> {
  const maxWidth = opts.maxWidth ?? DEFAULT_MAX_WIDTH;
  const quality = opts.quality ?? DEFAULT_QUALITY;

  // Si el archivo ya es WebP pequeño, no re-procesar (perdería calidad).
  if (file.type === "image/webp" && file.size < 400_000) {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const ratio = bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
  const targetW = Math.round(bitmap.width * ratio);
  const targetH = Math.round(bitmap.height * ratio);

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo obtener canvas 2D context");
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob devolvió null"))),
      "image/webp",
      quality,
    );
  });

  // Nombre nuevo manteniendo el base original.
  const originalName = file.name.replace(/\.[^.]+$/, "");
  const newName = `${originalName || "image"}.webp`;
  return new File([blob], newName, { type: "image/webp" });
}
