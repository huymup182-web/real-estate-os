import { Module } from '@nestjs/common';

import { AuditLogsController } from './audit-logs.controller.js';
import { AuditLogsService } from './audit-logs.service.js';
import { AuditService } from './audit.service.js';

/**
 * Module audit: mọi module nghiệp vụ dùng AuditService để ghi nhật ký thao tác; `GET /audit-logs` để xem
 * (TASK-112).
 */
@Module({
  controllers: [AuditLogsController],
  providers: [AuditService, AuditLogsService],
  exports: [AuditService],
})
export class AuditModule {}
