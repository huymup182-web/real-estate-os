import type { PropertyDetailView } from '../properties/property.response.js';

/** Nhãn tiếng Việt của giá trị BĐS gửi cho LLM (cùng nhãn admin `admin/src/lib/properties.ts`). */
export const PROPERTY_TYPE_LABELS: Readonly<Record<string, string>> = {
  HOUSE: 'Nhà phố, nhà riêng',
  APARTMENT: 'Căn hộ',
  VILLA: 'Biệt thự',
  SHOPHOUSE: 'Shophouse',
  LAND: 'Đất thổ cư',
  LAND_PLOT: 'Đất nền',
  AGRICULTURAL_LAND: 'Đất nông nghiệp, vườn',
  WAREHOUSE: 'Kho, xưởng',
  OTHER: 'Khác',
};
export const LEGAL_STATUS_LABELS: Readonly<Record<string, string>> = {
  PRIVATE_BOOK: 'Sổ riêng',
  SHARED_BOOK: 'Sổ chung',
  PENDING_BOOK: 'Chờ cấp sổ',
  SALE_CONTRACT: 'HĐ mua bán, góp vốn',
  HANDWRITTEN: 'Giấy tay, vi bằng',
  OTHER: 'Khác',
};
export const DIRECTION_LABELS: Readonly<Record<string, string>> = {
  N: 'Bắc',
  S: 'Nam',
  E: 'Đông',
  W: 'Tây',
  NE: 'Đông Bắc',
  NW: 'Tây Bắc',
  SE: 'Đông Nam',
  SW: 'Tây Nam',
};
export const ROAD_ACCESS_LABELS: Readonly<Record<string, string>> = {
  CAR: 'Ô tô vào được',
  MOTORBIKE: 'Xe máy',
  WALK: 'Đi bộ',
};
const TRANSACTION_TYPE_LABELS: Readonly<Record<string, string>> = { SALE: 'Bán', RENT: 'Cho thuê' };

/** "3,3 tỷ", "850 triệu" (giá trị gửi LLM, giữ đúng số trong database). */
export function vnMoney(value: number): string {
  const format = (n: number) =>
    n.toLocaleString('vi-VN', { maximumFractionDigits: 3 }).replace(/\u00a0/g, ' ');
  return value >= 1_000_000_000
    ? `${format(value / 1_000_000_000)} tỷ`
    : `${format(value / 1_000_000)} triệu`;
}

export function vnArea(value: number): string {
  return `${value.toLocaleString('vi-VN')} m²`;
}

function label(map: Readonly<Record<string, string>>, value: string | null): string | null {
  return value ? (map[value] ?? null) : null;
}

/**
 * Thông số BĐS gửi LLM (TASK-135, TASK-136): chỉ dữ liệu thật trong database, nhãn tiếng Việt. Không có địa chỉ
 * chi tiết, chủ nhà, môi giới, hoa hồng hay mô tả (mô tả do tính năng tự thêm khi cần).
 */
export function propertyFacts(property: PropertyDetailView): Record<string, unknown> {
  return {
    ma: property.code,
    tieu_de: property.title,
    giao_dich: label(TRANSACTION_TYPE_LABELS, property.transactionType),
    loai: PROPERTY_TYPE_LABELS[property.propertyType] ?? property.propertyType,
    gia: vnMoney(property.price),
    dien_tich: vnArea(property.area),
    gia_m2: property.pricePerM2 === null ? null : `${vnMoney(property.pricePerM2)}/m²`,
    phong_ngu: property.bedrooms,
    phong_tam: property.bathrooms,
    so_tang: property.floors,
    huong: label(DIRECTION_LABELS, property.direction),
    phap_ly: label(LEGAL_STATUS_LABELS, property.legalStatus),
    duong_vao: label(ROAD_ACCESS_LABELS, property.roadAccess),
    do_rong_duong_m: property.roadWidth,
    khu_vuc: `${property.wardName}, ${property.provinceName}`,
  };
}
