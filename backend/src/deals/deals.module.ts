import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../audit/audit.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { PropertiesModule } from '../properties/properties.module.js';
import { Deal } from './deal.entity.js';
import { DealsController } from './deals.controller.js';
import { DealsService } from './deals.service.js';

/** Module giao dịch (phase0/02-ARCHITECTURE.md mục 2.1: deals, đọc customers và properties). */
@Module({
  imports: [TypeOrmModule.forFeature([Deal]), AuditModule, CustomersModule, PropertiesModule],
  controllers: [DealsController],
  providers: [DealsService],
})
export class DealsModule {}
