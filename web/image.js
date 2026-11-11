// Photo downscaling, on the device, before anything is stored (SPEC §6.3).

/**
 * Resize an image File/Blob so its long edge is at most `maxEdge` px and
 * re-encode as JPEG. Honors EXIF orientation, so iPhone photos stay upright.
 * Resolves to { blob, width, height }.
 */
export async function downscaleImage(file, { maxEdge = 1600, quality = 0.85 } = {}) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Couldn't read that image. Try a JPEG or PNG.");
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("Couldn't process that photo.");
  return { blob, width, height };
}
