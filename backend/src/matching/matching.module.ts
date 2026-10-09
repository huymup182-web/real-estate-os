import { Module } from '@nestjs/common';

import { CustomersModule } from '../customers/customers.module.js';
import { PropertiesModule } from '../properties/properties.module.js';
import { MatchingController } from './matching.controller.js';
import { MatchingService } from './matching.service.js';

/** Module matching BĐS ↔ khách (Phase 7). */
@Module({
  imports: [CustomersModule, PropertiesModule],
  controllers: [MatchingController],
  providers: [MatchingService],
  exports: [MatchingService],
})
export class MatchingModule {}
