import { Module } from '@nestjs/common';

import { AuditService } from './audit.service.js';

/** Module audit: mọi module nghiệp vụ dùng AuditService để ghi nhật ký thao tác. */
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
