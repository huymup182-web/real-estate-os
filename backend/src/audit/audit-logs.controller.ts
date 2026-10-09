import { Controller, Get, Query, Req } from '@nestjs/common';

import type { RequestUser } from '../auth/jwt-auth.guard.js';
import { RequirePermission } from '../auth/permission.guard.js';
import { TenantId } from '../auth/tenant.guard.js';
import type { Paginated } from '../common/response/paginated.js';
import { actorOf } from '../properties/properties.controller.js';
import { type AuditLogResponse, AuditLogsService } from './audit-logs.service.js';
import { AuditLogQueryDto } from './dto/audit-log-query.dto.js';

/** Nhật ký thao tác của công ty (TASK-112), chỉ đọc. */
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly logs: AuditLogsService) {}

  /** `GET /api/v1/audit-logs?entityType&entityId&userId&action&from&to&page&pageSize` → mới nhất trước. */
  @Get()
  @RequirePermission('audit.view')
  findAll(
    @TenantId() tenantId: string,
    @Req() req: { user: RequestUser },
    @Query() query: AuditLogQueryDto,
  ): Promise<Paginated<AuditLogResponse>> {
    const scope = req.user.permissions['audit.view'];
    return this.logs.findAll(actorOf(tenantId, req.user), query, scope);
  }
}
