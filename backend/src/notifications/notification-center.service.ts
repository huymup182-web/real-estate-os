import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { AuthenticatedUser } from '../auth/access-token.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { Paginated } from '../common/response/paginated.js';
import type { NotificationListQueryDto } from './dto/notification-list-query.dto.js';
import type { NotificationType } from './notification-values.js';

export interface NotificationResponse {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}

const COLUMNS = `id, type, title, body, data, read_at AS "readAt", created_at AS "createdAt"`;
const NOT_FOUND = 'Không tìm thấy thông báo';

/**
 * Hộp thư thông báo của người đang đăng nhập (TASK-099). Mỗi người chỉ thấy và đánh dấu thông báo gửi
 * cho chính mình (của người khác → 404). Thông báo do `NotificationsService.notify` tạo (TASK-092).
 */
@Injectable()
export class NotificationCenterService {
  constructor(private readonly dataSource: DataSource) {}

  /** Mới nhất trước; lọc chưa đọc và theo loại. */
  async findAll(
    user: AuthenticatedUser,
    query: NotificationListQueryDto,
  ): Promise<Paginated<NotificationResponse>> {
    const conditions = ['user_id = $1'];
    const params: unknown[] = [user.userId];
    if (query.unread !== undefined) {
      conditions.push(query.unread ? 'read_at IS NULL' : 'read_at IS NOT NULL');
    }
    if (query.type) {
      params.push(query.type);
      conditions.push(`type = ANY($${params.length}::text[])`);
    }
    const where = conditions.join(' AND ');
    const [count] = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM notifications WHERE ${where}`,
      params,
    )) as { total: number }[];
    const rows = (await this.dataSource.query(
      `SELECT ${COLUMNS} FROM notifications WHERE ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.pageSize, query.offset],
    )) as NotificationResponse[];
    return new Paginated(rows, query.page, query.pageSize, count?.total ?? 0);
  }

  /** Số thông báo chưa đọc (badge trên app). */
  async unreadCount(user: AuthenticatedUser): Promise<{ count: number }> {
    const [row] = (await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
      [user.userId],
    )) as { count: number }[];
    return { count: row?.count ?? 0 };
  }

  /** Đánh dấu đã đọc; đã đọc rồi thì giữ thời điểm đọc đầu tiên. */
  async markRead(user: AuthenticatedUser, id: string): Promise<NotificationResponse> {
    const [rows] = (await this.dataSource.query(
      `UPDATE notifications SET read_at = COALESCE(read_at, now())
        WHERE id = $1 AND user_id = $2
        RETURNING ${COLUMNS}`,
      [id, user.userId],
    )) as [NotificationResponse[], number];
    const [row] = rows;
    if (!row) {
      throw new AppException(ErrorCode.NOT_FOUND, NOT_FOUND);
    }
    return row;
  }

  /** Đánh dấu mọi thông báo chưa đọc là đã đọc; trả số thông báo vừa đánh dấu. */
  async markAllRead(user: AuthenticatedUser): Promise<{ count: number }> {
    const [, count] = (await this.dataSource.query(
      `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`,
      [user.userId],
    )) as [unknown, number];
    return { count };
  }
}
