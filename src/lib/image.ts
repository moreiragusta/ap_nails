/**
 * Recorta a foto no formato 4:3 (centro) e comprime em WebP no próprio celular,
 * para o envio ser rápido e não ocupar espaço à toa.
 */
export async function preparePhoto(file: File, width = 1200, ratio = 4 / 3, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
    .catch(() => createImageBitmap(file));
  const srcRatio = bitmap.width / bitmap.height;
  let sw = bitmap.width;
  let sh = bitmap.height;
  if (srcRatio > ratio) sw = Math.round(sh * ratio);
  else sh = Math.round(sw / ratio);
  const sx = Math.round((bitmap.width - sw) / 2);
  const sy = Math.round((bitmap.height - sh) / 2);
  const outW = Math.min(width, sw);
  const outH = Math.round(outW / ratio);
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', quality));
  if (blob && blob.type === 'image/webp') return blob;
  // Navegadores sem WebP no canvas: JPEG.
  return new Promise<Blob>((r, j) => canvas.toBlob((b) => (b ? r(b) : j(new Error('Falha ao processar a foto'))), 'image/jpeg', 0.85));
}
