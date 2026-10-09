import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { assertTenant } from '../database/tenant.repository.js';
import {
  MAX_NOTIFICATION_RECIPIENTS,
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_DATA_MAX,
  NOTIFICATION_TITLE_MAX,
  NOTIFICATION_TYPES,
  type NotificationType,
} from './notification-values.js';
import { PushSender } from './push-sender.js';

/** Một lần gửi thông báo tới một hoặc nhiều người trong cùng công ty. */
export interface NotifyInput {
  tenantId: string;
  userIds: string[];
  type: NotificationType;
  title: string;
  body: string;
  /** Dữ liệu cho app mở đúng màn hình, vd `{ propertyId }`. */
  data?: Record<string, unknown>;
}

export interface CreatedNotification {
  id: string;
  userId: string;
}

/**
 * Gửi thông báo (TASK-092): ghi vào hộp thư (`notifications`) rồi đẩy qua `PushSender`. Các module khác
 * (BĐS mới, matching, lịch hẹn, xác minh — TASK-095..098) gọi `notify` sau khi transaction của chúng đã
 * commit. Đây là API nội bộ, không có route; hộp thư cho người dùng làm ở TASK-099.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly push: PushSender,
  ) {}

  /**
   * Ghi một thông báo cho mỗi người nhận rồi đẩy tới thiết bị.
   * - Chỉ gửi cho user đang ACTIVE, chưa xoá, cùng công ty `tenantId`; id khác bị bỏ qua (không lỗi). Id
   *   trùng chỉ gửi một lần.
   * - Đầu vào sai (loại, tiêu đề/nội dung rỗng hoặc quá dài, `data` không phải object hoặc quá lớn, quá
   *   nhiều người nhận) là lỗi lập trình → ném Error.
   * - Đẩy lỗi không làm hỏng việc gửi: thông báo vẫn nằm trong hộp thư, `push_sent_at` để trống. Đẩy được
   *   thì ghi `push_sent_at`.
   */
  async notify(input: NotifyInput): Promise<CreatedNotification[]> {
    assertTenant(input.tenantId);
    const { title, body, data } = validate(input);
    const userIds = [...new Set(input.userIds)];
    if (userIds.length === 0) {
      return [];
    }
    const rows = (await this.dataSource.query(
      `INSERT INTO notifications (tenant_id, user_id, type, title, body, data)
       SELECT u.tenant_id, u.id, $3, $4, $5, $6::jsonb
         FROM users u
        WHERE u.tenant_id = $1 AND u.id = ANY($2::uuid[])
          AND u.deleted_at IS NULL AND u.status = 'ACTIVE'
       RETURNING id, user_id AS "userId"`,
      [input.tenantId, userIds, input.type, title, body, JSON.stringify(data)],
    )) as CreatedNotification[];

    for (const row of rows) {
      await this.pushOne({
        notificationId: row.id,
        userId: row.userId,
        type: input.type,
        title,
        body,
        data,
      });
    }
    return rows;
  }

  private async pushOne(message: Parameters<PushSender['send']>[0]): Promise<void> {
    try {
      if (await this.push.send(message)) {
        await this.dataSource.query(`UPDATE notifications SET push_sent_at = now() WHERE id = $1`, [
          message.notificationId,
        ]);
      }
    } catch (error) {
      this.logger.warn('Đẩy thông báo thất bại, thông báo vẫn nằm trong hộp thư', {
        notificationId: message.notificationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function validate(input: NotifyInput): {
  title: string;
  body: string;
  data: Record<string, unknown>;
} {
  if (!(NOTIFICATION_TYPES as readonly string[]).includes(input.type)) {
    throw new Error(`Loại thông báo không hợp lệ: ${String(input.type)}`);
  }
  const title = input.title.trim();
  const body = input.body.trim();
  if (title === '' || title.length > NOTIFICATION_TITLE_MAX) {
    throw new Error(`Tiêu đề thông báo phải có 1..${NOTIFICATION_TITLE_MAX} ký tự`);
  }
  if (body === '' || body.length > NOTIFICATION_BODY_MAX) {
    throw new Error(`Nội dung thông báo phải có 1..${NOTIFICATION_BODY_MAX} ký tự`);
  }
  const data = input.data ?? {};
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('data của thông báo phải là object');
  }
  if (JSON.stringify(data).length > NOTIFICATION_DATA_MAX) {
    throw new Error(`data của thông báo dài quá ${NOTIFICATION_DATA_MAX} ký tự`);
  }
  if (input.userIds.length > MAX_NOTIFICATION_RECIPIENTS) {
    throw new Error(`Gửi tối đa ${MAX_NOTIFICATION_RECIPIENTS} người nhận mỗi lần`);
  }
  return { title, body, data };
}
