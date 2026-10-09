import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CompanyController, DepartmentsController } from './company.controller.js';
import { CompanyService } from './company.service.js';
import { DepartmentsService } from './departments.service.js';

/** Module công ty (phase0/02-ARCHITECTURE.md mục 2.1: companies, departments). */
@Module({
  imports: [AuditModule, AuthModule],
  controllers: [CompanyController, DepartmentsController],
  providers: [CompanyService, DepartmentsService],
})
export class CompanyModule {}
