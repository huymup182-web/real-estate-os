/** Giới hạn ảnh BĐS (phase0/05-API-CONVENTIONS.md mục 9). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES_PER_PROPERTY = 30;
/** Cạnh ảnh lớn nhất client được khai báo (pixel). */
export const MAX_IMAGE_DIMENSION = 20_000;

/** Định dạng ảnh cho phép và đuôi file trên storage. */
export const IMAGE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
} as const;
export type ImageMimeType = keyof typeof IMAGE_EXTENSIONS;
export const IMAGE_MIME_TYPES = Object.keys(IMAGE_EXTENSIONS) as ImageMimeType[];

/** Đường dẫn object: `{tenant_id}/properties/{property_id}/{image_id}.{ext}` (phase0/02-ARCHITECTURE.md). */
export function imageStorageKey(
  tenantId: string,
  propertyId: string,
  imageId: string,
  mimeType: ImageMimeType,
): string {
  return `${tenantId}/properties/${propertyId}/${imageId}.${IMAGE_EXTENSIONS[mimeType]}`;
}

/** Thumbnail: cạnh dài tối đa (pixel), lưu webp cạnh ảnh gốc. */
export const THUMBNAIL_MAX_SIZE = 480;
export const THUMBNAIL_MIME_TYPE = 'image/webp';

/** `{...}/{image_id}.jpg` → `{...}/{image_id}_thumb.webp` (cùng thư mục BĐS). */
export function thumbnailStorageKey(storageKey: string): string {
  return `${storageKey.replace(/\.[a-z]+$/, '')}_thumb.webp`;
}
