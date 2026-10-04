import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { getRequestContext } from '../common/logging/request-context.js';

/** Thay đổi của một thao tác: `{ field: [giá trị cũ, giá trị mới] }`. Không bao giờ chứa mật khẩu/token. */
export type AuditChanges = Record<string, [unknown, unknown]>;

export interface AuditEntry {
  tenantId: string;
  /** null khi hệ thống tự làm (job nền). */
  userId: string | null;
  /** Dạng `module.hanh_dong`, vd `property.update`. */
  action: string;
  entityType: string;
  entityId: string;
  changes?: AuditChanges | null;
}

/**
 * Ghi nhật ký thao tác vào `audit_logs` (phase0/05-API-CONVENTIONS.md mục 10, TASK-063). Gọi trong cùng
 * transaction với thay đổi để nhật ký và dữ liệu luôn khớp nhau. Request id, IP, user agent lấy từ
 * request context (ngoài request thì để trống).
 */
@Injectable()
export class AuditService {
  async record(manager: EntityManager, entry: AuditEntry): Promise<void> {
    const context = getRequestContext();
    await manager.query(
      `INSERT INTO audit_logs
         (tenant_id, user_id, action, entity_type, entity_id, changes, ip_address, user_agent,
          request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.tenantId,
        entry.userId,
        entry.action,
        entry.entityType,
        entry.entityId,
        entry.changes ? JSON.stringify(entry.changes) : null,
        context?.ipAddress ?? null,
        context?.userAgent ?? null,
        context?.requestId ?? null,
      ],
    );
  }
}
