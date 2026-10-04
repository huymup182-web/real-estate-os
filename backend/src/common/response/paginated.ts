/** Thông tin phân trang trả trong `meta` (phase0/05-API-CONVENTIONS.md mục 3). */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Kết quả danh sách có phân trang. Controller trả về `Paginated`, interceptor tách thành `data` + `meta`. */
export class Paginated<T> {
  readonly meta: PaginationMeta;

  constructor(
    readonly items: T[],
    page: number,
    pageSize: number,
    total: number,
  ) {
    this.meta = { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
  }
}
