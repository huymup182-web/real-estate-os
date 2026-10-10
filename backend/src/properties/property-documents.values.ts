/** Loại giấy tờ BĐS (Huy Lê duyệt ngày 2026-10-04, TASK-016). OWNER_ID_DOCUMENT là CCCD chủ nhà. */
export const DOCUMENT_TYPES = [
  'LAND_CERTIFICATE',
  'CONSTRUCTION_PERMIT',
  'SURVEY_MAP',
  'SALE_CONTRACT',
  'DEPOSIT_CONTRACT',
  'BROKERAGE_AGREEMENT',
  'OWNER_ID_DOCUMENT',
  'OTHER',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Giấy tờ chứa thông tin cá nhân chủ nhà: cần thêm quyền xem liên hệ chủ nhà. */
export const OWNER_DOCUMENT_TYPES: readonly DocumentType[] = ['OWNER_ID_DOCUMENT'];

/** Định dạng file giấy tờ cho phép và đuôi file trên storage. */
export const DOCUMENT_EXTENSIONS = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
} as const;
export type DocumentMimeType = keyof typeof DOCUMENT_EXTENSIONS;
export const DOCUMENT_MIME_TYPES = Object.keys(DOCUMENT_EXTENSIONS) as DocumentMimeType[];

/** Giới hạn giấy tờ: cùng mức với ảnh (phase0/05-API-CONVENTIONS.md mục 9). */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_PROPERTY = 30;

/** Link tải giấy tờ có hạn ngắn vì là dữ liệu nhạy cảm (giây). */
export const DOCUMENT_URL_TTL_SECONDS = 5 * 60;

/** `{tenant_id}/properties/{property_id}/documents/{document_id}.{ext}` (database TASK-016). */
export function documentStorageKey(
  tenantId: string,
  propertyId: string,
  documentId: string,
  mimeType: DocumentMimeType,
): string {
  return `${tenantId}/properties/${propertyId}/documents/${documentId}.${DOCUMENT_EXTENSIONS[mimeType]}`;
}
