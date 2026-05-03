/**
 * Pipeline de captura de fotos para evidencia de limpieza.
 *
 * Toma un File del `<input type="file">` (cámara o galería del celular),
 * lo redimensiona, le quema un timestamp visible en los píxeles, y devuelve
 * un JPEG comprimido listo para subir.
 *
 * El timestamp quemado es la primera línea de defensa anti-fraude: si el
 * cleaner sube una foto de la limpieza anterior, se nota porque la fecha
 * en la esquina no coincide con el día de la tarea. La metadata EXIF se
 * manipula fácil; los píxeles no.
 *
 * El `uploaded_at` server-side (en /api/cleaning-tasks/:id/photos) es la
 * fuente de verdad real — éste de acá sólo es para que un humano que mira
 * la foto sepa cuándo se tomó sin abrir un ticket.
 */
export interface CaptureOptions {
  maxSide?: number;
  quality?: number;
  watermarkLabel?: string;
}

export interface CaptureResult {
  blob: Blob;
  width: number;
  height: number;
  takenAt: Date;
}

const DEFAULT_MAX_SIDE = 1600;
const DEFAULT_QUALITY = 0.72;

export async function capturePhoto(
  file: File,
  opts: CaptureOptions = {},
): Promise<CaptureResult> {
  const maxSide = opts.maxSide ?? DEFAULT_MAX_SIDE;
  const quality = opts.quality ?? DEFAULT_QUALITY;
  const takenAt = new Date();

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Canvas 2D no soportado en este navegador");
  }

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  drawTimestampOverlay(ctx, width, height, takenAt, opts.watermarkLabel);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) {
    throw new Error("No se pudo comprimir la imagen a JPEG");
  }

  return { blob, width, height, takenAt };
}

function drawTimestampOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  takenAt: Date,
  label?: string,
): void {
  const dd = String(takenAt.getDate()).padStart(2, "0");
  const mm = String(takenAt.getMonth() + 1).padStart(2, "0");
  const yyyy = takenAt.getFullYear();
  const hh = String(takenAt.getHours()).padStart(2, "0");
  const mi = String(takenAt.getMinutes()).padStart(2, "0");
  const timestamp = `${dd}/${mm}/${yyyy} ${hh}:${mi}`;

  const fontSize = Math.max(14, Math.round(width * 0.025));
  const padding = Math.round(fontSize * 0.6);
  const lineGap = Math.round(fontSize * 0.3);
  const trimmedLabel = label?.trim();

  ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
  const tsWidth = ctx.measureText(timestamp).width;
  const labelWidth = trimmedLabel ? ctx.measureText(trimmedLabel).width : 0;
  const boxWidth = Math.max(tsWidth, labelWidth) + padding * 2;
  const boxHeight =
    fontSize * (trimmedLabel ? 2 : 1) +
    (trimmedLabel ? lineGap : 0) +
    padding * 2;

  const boxX = width - boxWidth - padding;
  const boxY = height - boxHeight - padding;

  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

  ctx.fillStyle = "white";
  ctx.textBaseline = "top";
  ctx.fillText(timestamp, boxX + padding, boxY + padding);
  if (trimmedLabel) {
    ctx.fillText(
      trimmedLabel,
      boxX + padding,
      boxY + padding + fontSize + lineGap,
    );
  }
}
