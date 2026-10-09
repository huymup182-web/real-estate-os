import { Injectable, type OnModuleInit } from '@nestjs/common';

import { type ExpiredVerification, PropertyEvents } from '../properties/property-events.js';
import { NOTIFICATION_BODY_MAX } from './notification-values.js';
import { NotificationsService } from './notifications.service.js';

export const VERIFY_REQUIRED_TITLE = 'BĐS cần xác minh lại';
/** Số BĐS nêu mã trong nội dung; còn lại ghi "và N BĐS khác". */
export const VERIFY_CODES_IN_BODY = 3;
/** Số BĐS ghi trong `data` (giữ JSON dưới NOTIFICATION_DATA_MAX). */
const VERIFY_IDS_IN_DATA = 50;

/**
 * Nhắc xác minh (TASK-098): mỗi lần job xác minh (TASK-062) chuyển BĐS quá hạn sang VERIFY_REQUIRED,
 * môi giới phụ trách nhận một thông báo VERIFY_REQUIRED gộp các BĐS của mình trong lần chạy đó.
 * BĐS chỉ chuyển trạng thái một lần cho tới khi được xác minh lại, nên không nhắc lặp lại.
 */
@Injectable()
export class VerifyReminderNotifier implements OnModuleInit {
  constructor(
    private readonly events: PropertyEvents,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.events.onVerificationExpired((properties) =>
      this.handle(properties).then(() => undefined),
    );
  }

  /** Trả số môi giới được thông báo. */
  async handle(properties: ExpiredVerification[]): Promise<number> {
    const byAgent = new Map<string, ExpiredVerification[]>();
    for (const property of properties) {
      const key = `${property.tenantId}:${property.agentId}`;
      byAgent.set(key, [...(byAgent.get(key) ?? []), property]);
    }

    let notified = 0;
    for (const group of byAgent.values()) {
      const [first] = group;
      if (!first) {
        continue;
      }
      const sorted = [...group].sort((a, b) => a.code.localeCompare(b.code));
      const created = await this.notifications.notify({
        tenantId: first.tenantId,
        userIds: [first.agentId],
        type: 'VERIFY_REQUIRED',
        title: VERIFY_REQUIRED_TITLE,
        body: verifyBody(sorted),
        data: {
          count: sorted.length,
          propertyIds: sorted.slice(0, VERIFY_IDS_IN_DATA).map((property) => property.propertyId),
        },
      });
      notified += created.length;
    }
    return notified;
  }
}

/**
 * Một BĐS: `BDS-000123 Nhà phố đã quá hạn xác minh, cần xác minh lại để tiếp tục bán.`; nhiều BĐS:
 * `4 BĐS đã quá hạn xác minh: BDS-000123, BDS-000124, BDS-000125 và 1 BĐS khác. Cần xác minh lại…`
 */
function verifyBody(properties: ExpiredVerification[]): string {
  const [only] = properties;
  if (properties.length === 1 && only) {
    return `${only.code} ${only.title} đã quá hạn xác minh, cần xác minh lại để tiếp tục bán.`.slice(
      0,
      NOTIFICATION_BODY_MAX,
    );
  }
  const codes = properties
    .slice(0, VERIFY_CODES_IN_BODY)
    .map((property) => property.code)
    .join(', ');
  const rest = properties.length - VERIFY_CODES_IN_BODY;
  const more = rest > 0 ? ` và ${rest} BĐS khác` : '';
  return `${properties.length} BĐS đã quá hạn xác minh: ${codes}${more}. Cần xác minh lại để tiếp tục bán.`;
}
