import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module.js';
import { Customer } from './customer.entity.js';
import { CustomerPreference } from './customer-preference.entity.js';
import { CustomerPreferencesController } from './customer-preferences.controller.js';
import { CustomerPreferencesService } from './customer-preferences.service.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';

/** Module khách hàng (Phase 6 CRM). */
@Module({
  imports: [TypeOrmModule.forFeature([Customer, CustomerPreference]), AuditModule],
  controllers: [CustomersController, CustomerPreferencesController],
  providers: [CustomersService, CustomerPreferencesService],
})
export class CustomersModule {}
