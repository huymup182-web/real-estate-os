import { Module } from '@nestjs/common';

import { CustomersModule } from '../customers/customers.module.js';
import { PropertiesModule } from '../properties/properties.module.js';
import { MatchingService } from './matching.service.js';

/** Module matching BĐS ↔ khách (Phase 7). API ở TASK-090. */
@Module({
  imports: [CustomersModule, PropertiesModule],
  providers: [MatchingService],
  exports: [MatchingService],
})
export class MatchingModule {}
