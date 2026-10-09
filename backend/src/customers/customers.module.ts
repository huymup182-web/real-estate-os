import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module.js';
import { PropertiesModule } from '../properties/properties.module.js';
import { Customer } from './customer.entity.js';
import {
  CustomerActivitiesController,
  CustomerNotesController,
} from './customer-activities.controller.js';
import { CustomerActivitiesService } from './customer-activities.service.js';
import { CustomerPreference } from './customer-preference.entity.js';
import { CustomerPreferencesController } from './customer-preferences.controller.js';
import { CustomerPreferencesService } from './customer-preferences.service.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';

/** Module khách hàng (Phase 6 CRM). */
@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, CustomerPreference]),
    AuditModule,
    PropertiesModule,
  ],
  controllers: [
    CustomersController,
    CustomerPreferencesController,
    CustomerNotesController,
    CustomerActivitiesController,
  ],
  providers: [CustomersService, CustomerPreferencesService, CustomerActivitiesService],
})
export class CustomersModule {}
