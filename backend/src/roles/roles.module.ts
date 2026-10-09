import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { RolesController } from './roles.controller.js';
import { RolesService } from './roles.service.js';

/** Module vai trò (phase0/02-ARCHITECTURE.md mục 2.1: roles, role_permissions). */
@Module({
  imports: [AuditModule, AuthModule],
  controllers: [RolesController],
  providers: [RolesService],
})
export class RolesModule {}
