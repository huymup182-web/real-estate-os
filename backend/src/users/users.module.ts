import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/** Module người dùng (phase0/02-ARCHITECTURE.md mục 2.1: users, user_roles). */
@Module({
  imports: [AuditModule, AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
