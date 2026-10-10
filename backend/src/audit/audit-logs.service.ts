import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { PermissionScope } from '../auth/permission.service.js';
import { scopeCondition } from '../auth/record-scope.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import { Paginated } from '../common/response/paginated.js';
import type { Actor } from '../properties/properties.service.js';
import type { AuditLogQueryDto } from './dto/audit-log-query.dto.js';

/** Một dòng nhật ký trả cho client. */
export interface AuditLogResponse {
  id: string;
  /** null khi hệ thống tự làm (job nền). */
  user: { id: string; fullName: string } | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  changes: Record<string, [unknown, unknown]> | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: Date;
}

interface AuditLogRow {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  changes: Record<string, [unknown, unknown]> | null;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: Date;
}

/**
 * Đọc nhật ký thao tác (TASK-112), bảng `audit_logs` chỉ thêm (TASK-025). Quyền `audit.view`; phạm vi xét
 * theo người thao tác (OWN: của mình; TEAM, DEPARTMENT: người trong team, phòng ban; COMPANY: cả công ty,
 * gồm cả thao tác của hệ thống).
 */
@Injectable()
export class AuditLogsService {
  constructor(private readonly dataSource: DataSource) {}

  /** Nhật ký của công ty trong phạm vi xem, mới nhất trước; `from` ≥ `to` → 400. */
  async findAll(
    actor: Actor,
    query: AuditLogQueryDto,
    scope: PermissionScope | undefined,
  ): Promise<Paginated<AuditLogResponse>> {
    if (query.from && query.to && query.from.getTime() >= query.to.getTime()) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, undefined, [
        { field: 'to', message: 'to phải sau from' },
      ]);
    }
    let base = this.dataSource
      .createQueryBuilder()
      .from('audit_logs', 'l')
      .where('l.tenant_id = :tenantId', { tenantId: actor.tenantId })
      .andWhere(
        scope ? scopeCondition(scope, { agent: 'l.user_id', creator: 'l.user_id' }) : 'FALSE',
      )
      .setParameter('scopeUserId', actor.userId);
    const filters: [keyof AuditLogQueryDto, string][] = [
      ['entityType', 'l.entity_type = :entityType'],
      ['entityId', 'l.entity_id = :entityId'],
      ['userId', 'l.user_id = :userId'],
      ['action', 'l.action = :action'],
      ['from', 'l.created_at >= :from'],
      ['to', 'l.created_at < :to'],
    ];
    for (const [key, condition] of filters) {
      if (query[key] !== undefined) {
        base = base.andWhere(condition, { [key]: query[key] });
      }
    }
    const [{ total }] = (await base.clone().select('count(*)::int', 'total').getRawMany()) as [
      { total: number },
    ];
    const rows = await base
      .leftJoin('users', 'u', 'u.id = l.user_id')
      .select([
        'l.id AS id',
        'l.user_id AS user_id',
        'u.full_name AS user_name',
        'l.action AS action',
        'l.entity_type AS entity_type',
        'l.entity_id AS entity_id',
        'l.changes AS changes',
        'host(l.ip_address) AS ip_address',
        'l.user_agent AS user_agent',
        'l.request_id AS request_id',
        'l.created_at AS created_at',
      ])
      .orderBy('l.created_at', 'DESC')
      .addOrderBy('l.id', 'DESC')
      .offset(query.offset)
      .limit(query.pageSize)
      .getRawMany<AuditLogRow>();
    return new Paginated(rows.map(toResponse), query.page, query.pageSize, total);
  }
}

function toResponse(row: AuditLogRow): AuditLogResponse {
  return {
    id: row.id,
    user: row.user_id ? { id: row.user_id, fullName: row.user_name ?? '' } : null,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    changes: row.changes,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    requestId: row.request_id,
    createdAt: row.created_at,
  };
}
