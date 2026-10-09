import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module.js';
import { Customer } from './customer.entity.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';

/** Module khách hàng (Phase 6 CRM). */
@Module({
  imports: [TypeOrmModule.forFeature([Customer]), AuditModule],
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
