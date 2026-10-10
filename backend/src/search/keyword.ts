/** Tối đa số từ lấy từ ô tìm kiếm (từ thừa bị bỏ). */
export const MAX_KEYWORD_TERMS = 10;
export const MAX_KEYWORD_LENGTH = 200;

/**
 * Từ khoá người dùng gõ → các từ không dấu, chữ thường, chỉ gồm a-z và 0-9 (TASK-064). Bỏ dấu tiếng
 * Việt giống `immutable_unaccent` ở database (đ → d) để gõ có dấu hay không dấu đều tìm được.
 */
export function keywordTerms(keyword: string): string[] {
  return keyword
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 0)
    .slice(0, MAX_KEYWORD_TERMS);
}

/**
 * Chuỗi `to_tsquery('simple', …)`: mọi từ phải có, từ cuối được tìm theo tiền tố (đang gõ dở như
 * "vinh ha" vẫn ra "Vĩnh Hải"). Từ chỉ gồm a-z0-9 nên không chèn được cú pháp tsquery. Không có từ nào
 * dùng được → null.
 */
export function keywordTsQuery(keyword: string): string | null {
  const terms = keywordTerms(keyword);
  if (terms.length === 0) {
    return null;
  }
  return terms.map((term) => `${term}:*`).join(' & ');
}
