export interface FittedImage {
  blob: Blob;
  name: string;
  resized: boolean;
}

type FitType = "image/png" | "image/jpeg";

/* Longest canvas edge; keeps under browser canvas size limits. */
const MAX_FIT_EDGE = 4096;
const MAX_FIT_PASSES = 8;
const ALPHA_PROBE_EDGE = 512;
const MIN_FIT_EDGE = 16;
const JPEG_QUALITIES = [0.92, 0.85, 0.75, 0.65];
const DECODE_ERROR = "could not decode image to shrink it";

function scaleToEdge(w: number, h: number, edge: number): [number, number] {
  const k = Math.min(1, edge / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

function scaleToBox(w: number, h: number, bw: number, bh: number): [number, number] {
  const k = Math.min(1, bw / w, bh / h);
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(DECODE_ERROR);
  ctx.imageSmoothingQuality = "high";
  return [canvas, ctx];
}

function hasAlpha(bitmap: ImageBitmap): boolean {
  const [w, h] = scaleToEdge(bitmap.width, bitmap.height, ALPHA_PROBE_EDGE);
  const [, ctx] = canvas2d(w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

function encode(canvas: HTMLCanvasElement, type: FitType, quality?: number): Promise<Blob> {
  const { promise, resolve, reject } = Promise.withResolvers<Blob>();
  canvas.toBlob(
    (blob) => {
      if (blob) resolve(blob);
      else reject(new Error("could not encode image"));
    },
    type,
    quality,
  );
  return promise;
}

function renameExt(name: string, type: FitType): string {
  const ext = type === "image/png" ? ".png" : ".jpg";
  const dot = name.lastIndexOf(".");
  return `${dot > 0 ? name.slice(0, dot) : name}${ext}`;
}

/* Returns the file untouched when it fits (bytes, and `box` [width, height] when given), else a
 * downscaled PNG/JPEG re-encode under maxBytes that fits inside `box` (aspect kept). */
export async function fitImageUnder(
  file: File,
  maxBytes: number,
  box?: readonly [number, number],
): Promise<FittedImage> {
  if (!box && file.size <= maxBytes) return { blob: file, name: file.name, resized: false };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(DECODE_ERROR);
  }
  try {
    if (box && bitmap.width <= box[0] && bitmap.height <= box[1] && file.size <= maxBytes)
      return { blob: file, name: file.name, resized: false };
    let [w, h] = scaleToBox(
      bitmap.width,
      bitmap.height,
      box?.[0] ?? MAX_FIT_EDGE,
      box?.[1] ?? MAX_FIT_EDGE,
    );
    const type: FitType =
      file.type === "image/jpeg" || !hasAlpha(bitmap) ? "image/jpeg" : "image/png";

    for (let pass = 0; pass < MAX_FIT_PASSES; pass++) {
      if (Math.max(w, h) < MIN_FIT_EDGE) break;
      const [canvas, ctx] = canvas2d(w, h);
      if (type === "image/jpeg") {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(bitmap, 0, 0, w, h);

      let blob: Blob | null = null;
      for (const quality of type === "image/png" ? [undefined] : JPEG_QUALITIES) {
        blob = await encode(canvas, type, quality);
        if (blob.size <= maxBytes) {
          return { blob, name: renameExt(file.name, type), resized: true };
        }
      }
      const size = blob?.size ?? maxBytes;
      const factor = Math.min(0.9, Math.max(0.5, Math.sqrt(maxBytes / size) * 0.95));
      w = Math.max(1, Math.round(w * factor));
      h = Math.max(1, Math.round(h * factor));
    }
    throw new Error("could not shrink image under the size limit");
  } finally {
    bitmap.close();
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") resolve(reader.result);
    else reject(new Error("could not read file"));
  };
  reader.onerror = () => reject(new Error("could not read file"));
  reader.readAsDataURL(blob);
  return promise;
}
