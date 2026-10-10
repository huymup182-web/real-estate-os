import { randomBytes } from 'node:crypto';

export const SLUG_MAX_LENGTH = 100;
const SUFFIX_LENGTH = 6;

/**
 * Đổi tên công ty thành slug dạng `cong-ty-bds-an-phat` (bỏ dấu tiếng Việt, chữ thường, nối bằng `-`).
 * Tên không còn ký tự chữ/số nào thì dùng `cong-ty`.
 */
export function toCompanySlug(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH - SUFFIX_LENGTH - 1)
    .replace(/-+$/g, '');
  return base || 'cong-ty';
}

/** Slug kèm hậu tố ngẫu nhiên, dùng khi slug gốc đã có công ty khác dùng. */
export function withRandomSuffix(slug: string): string {
  return `${slug}-${randomBytes(4).toString('hex').slice(0, SUFFIX_LENGTH)}`;
}
