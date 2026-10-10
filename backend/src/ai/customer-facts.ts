import type { DataSource } from 'typeorm';

import type { MatchPreference } from '../matching/match-score.js';
import {
  DIRECTION_LABELS,
  LEGAL_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  ROAD_ACCESS_LABELS,
  vnArea,
  vnMoney,
} from './property-facts.js';

/** Nhãn tiếng Việt của giá trị khách hàng gửi LLM (cùng nhãn admin `admin/src/lib/customers.ts`). */
export const CUSTOMER_STATUS_LABELS: Readonly<Record<string, string>> = {
  NEW: 'Mới',
  CONTACTED: 'Đã liên hệ',
  QUALIFIED: 'Có nhu cầu thật',
  VIEWING: 'Đi xem nhà',
  NEGOTIATING: 'Thương lượng',
  DEPOSIT: 'Đặt cọc',
  WON: 'Chốt thành công',
  LOST: 'Mất khách',
};
export const CUSTOMER_PURPOSE_LABELS: Readonly<Record<string, string>> = {
  LIVING: 'Để ở',
  INVESTMENT: 'Đầu tư',
  RENT: 'Cho thuê',
  OTHER: 'Khác',
};
export const PURCHASE_TIMELINE_LABELS: Readonly<Record<string, string>> = {
  IMMEDIATE: 'Mua ngay',
  WITHIN_3_MONTHS: 'Trong 3 tháng',
  WITHIN_6_MONTHS: 'Trong 6 tháng',
  OVER_6_MONTHS: 'Trên 6 tháng',
  UNKNOWN: 'Chưa rõ',
};
export const CUSTOMER_SOURCE_LABELS: Readonly<Record<string, string>> = {
  REFERRAL: 'Giới thiệu',
  WALK_IN: 'Khách tự đến',
  FACEBOOK: 'Facebook',
  ZALO: 'Zalo',
  TIKTOK: 'TikTok',
  WEBSITE: 'Website',
  BROKER_PARTNER: 'Đối tác môi giới',
  OLD_CUSTOMER: 'Khách cũ',
  OTHER: 'Khác',
};
export const ACTIVITY_TYPE_LABELS: Readonly<Record<string, string>> = {
  CALL: 'Gọi điện',
  MESSAGE: 'Nhắn tin',
  PROPERTY_SENT: 'Gửi BĐS',
  VIEWING: 'Đi xem',
  NEGOTIATION: 'Thương lượng',
  DEPOSIT: 'Đặt cọc',
  NOTE: 'Ghi chú',
  STATUS_CHANGE: 'Đổi bước',
  ASSIGNMENT: 'Giao khách',
};
const PREFERENCE_TRANSACTION_LABELS: Readonly<Record<string, string>> = {
  SALE: 'Mua',
  RENT: 'Thuê',
};

export function labelOf(
  map: Readonly<Record<string, string>>,
  value: string | null,
): string | null {
  return value ? (map[value] ?? value) : null;
}

function labels(values: string[] | null, map: Readonly<Record<string, string>>): string[] | null {
  return values?.length ? values.map((value) => map[value] ?? value) : null;
}

function range(min: number | null, max: number | null, unit: (n: number) => string): string | null {
  if (min !== null && max !== null) {
    return `${unit(min)} – ${unit(max)}`;
  }
  if (min !== null) {
    return `từ ${unit(min)}`;
  }
  return max !== null ? `tối đa ${unit(max)}` : null;
}

/** Nhu cầu gửi LLM: như `MatchPreference`, có thể thêm hướng nhà và trạng thái bật. */
export type PreferenceForFacts = MatchPreference & {
  directions?: string[] | null;
  isActive?: boolean;
};

/**
 * Nhu cầu của khách gửi LLM (TASK-135, TASK-140): nhãn tiếng Việt, khu vực đổi ra tên (một truy vấn cho mọi
 * nhu cầu). Không có thông tin cá nhân của khách.
 */
export async function preferenceFacts(
  dataSource: DataSource,
  preferences: readonly PreferenceForFacts[],
): Promise<Record<string, unknown>[]> {
  const ids = preferences.flatMap((preference) => [
    ...(preference.provinceIds ?? []),
    ...(preference.districtIds ?? []),
    ...(preference.wardIds ?? []),
  ]);
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const rows: { id: string; name: string }[] = await dataSource.query(
      `SELECT id, name FROM provinces WHERE id = ANY($1::uuid[])
       UNION ALL SELECT id, name FROM districts WHERE id = ANY($1::uuid[])
       UNION ALL SELECT id, name FROM wards WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    for (const row of rows) {
      names.set(row.id, row.name);
    }
  }

  return preferences.map((preference) => {
    const areaNames = [
      ...(preference.provinceIds ?? []),
      ...(preference.districtIds ?? []),
      ...(preference.wardIds ?? []),
    ]
      .map((id) => names.get(id))
      .filter((name) => name !== undefined);
    return {
      giao_dich: labelOf(PREFERENCE_TRANSACTION_LABELS, preference.transactionType),
      loai_bds: labels(preference.propertyTypes, PROPERTY_TYPE_LABELS),
      ngan_sach: range(preference.budgetMin, preference.budgetMax, vnMoney),
      dien_tich: range(preference.areaMin, preference.areaMax, vnArea),
      phong_ngu_toi_thieu: preference.bedroomsMin,
      khu_vuc: areaNames.length > 0 ? areaNames : null,
      huong: labels(preference.directions ?? null, DIRECTION_LABELS),
      phap_ly: labels(preference.legalStatuses, LEGAL_STATUS_LABELS),
      duong_vao_toi_thieu: labelOf(ROAD_ACCESS_LABELS, preference.minRoadAccess),
      ...(preference.isActive === undefined ? {} : { dang_bat: preference.isActive }),
    };
  });
}
