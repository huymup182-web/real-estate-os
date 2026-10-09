import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AuthenticatedUser } from '../auth/access-token.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { DeviceTokenStore } from './device-token-store.js';
import type { RegisterDeviceTokenDto } from './dto/register-device-token.dto.js';
import {
  DEVICE_TOKEN_STALE_DAYS,
  type DevicePlatform,
  MAX_DEVICES_PER_USER,
} from './notification-values.js';

export interface DeviceTokenResponse {
  id: string;
  platform: DevicePlatform;
  lastSeenAt: Date;
  createdAt: Date;
}

const NOT_FOUND = 'Không tìm thấy thiết bị';

/**
 * Token FCM của thiết bị (TASK-094). App gọi đăng ký sau khi đăng nhập và mỗi khi FCM cấp token mới,
 * gỡ khi đăng xuất. Một token chỉ thuộc người đăng nhập gần nhất trên thiết bị đó. Đồng thời là
 * `DeviceTokenStore` cho `FcmPushSender`.
 */
@Injectable()
export class DeviceTokensService extends DeviceTokenStore {
  constructor(private readonly dataSource: DataSource) {
    super();
  }

  /** Thêm hoặc làm mới token; vượt số thiết bị tối đa thì gỡ thiết bị lâu không dùng nhất. */
  register(user: AuthenticatedUser, dto: RegisterDeviceTokenDto): Promise<DeviceTokenResponse> {
    return this.dataSource.transaction(async (manager) => {
      const rows: DeviceTokenResponse[] = await manager.query(
        `INSERT INTO device_tokens (user_id, tenant_id, fcm_token, platform)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (fcm_token) DO UPDATE
           SET user_id = EXCLUDED.user_id, tenant_id = EXCLUDED.tenant_id,
               platform = EXCLUDED.platform, last_seen_at = now()
         RETURNING id, platform, last_seen_at AS "lastSeenAt", created_at AS "createdAt"`,
        [user.userId, user.tenantId, dto.token, dto.platform],
      );
      await manager.query(
        `DELETE FROM device_tokens
          WHERE user_id = $1
            AND id NOT IN (SELECT id FROM device_tokens WHERE user_id = $1
                            ORDER BY last_seen_at DESC, created_at DESC LIMIT $2)`,
        [user.userId, MAX_DEVICES_PER_USER],
      );
      const [row] = rows;
      if (!row) {
        throw new Error('Không ghi được device_tokens');
      }
      return row;
    });
  }

  /** Thiết bị của mình, dùng gần nhất trước. Không trả lại token. */
  findAll(user: AuthenticatedUser): Promise<DeviceTokenResponse[]> {
    return this.dataSource.query(
      `SELECT id, platform, last_seen_at AS "lastSeenAt", created_at AS "createdAt"
         FROM device_tokens WHERE user_id = $1
        ORDER BY last_seen_at DESC, created_at DESC`,
      [user.userId],
    );
  }

  /** Gỡ một thiết bị của mình (khi đăng xuất); thiết bị của người khác coi như không có (404). */
  async unregister(user: AuthenticatedUser, id: string): Promise<void> {
    const [, count] = (await this.dataSource.query(
      `DELETE FROM device_tokens WHERE id = $1 AND user_id = $2`,
      [id, user.userId],
    )) as [unknown, number];
    if (count === 0) {
      throw new AppException(ErrorCode.NOT_FOUND, NOT_FOUND);
    }
  }

  /** Xoá token FCM báo không còn hợp lệ, cho `FcmPushSender`. */
  async remove(tokens: string[]): Promise<void> {
    if (tokens.length > 0) {
      await this.dataSource.query(`DELETE FROM device_tokens WHERE fcm_token = ANY($1::text[])`, [
        tokens,
      ]);
    }
  }

  /** Token còn hạn của người nhận, cho `FcmPushSender`. */
  async tokensOf(userId: string): Promise<string[]> {
    const rows: { fcm_token: string }[] = await this.dataSource.query(
      `SELECT fcm_token FROM device_tokens
        WHERE user_id = $1 AND last_seen_at > now() - make_interval(days => $2)
        ORDER BY last_seen_at DESC`,
      [userId, DEVICE_TOKEN_STALE_DAYS],
    );
    return rows.map((row) => row.fcm_token);
  }
}
