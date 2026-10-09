import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PropertiesService } from './properties.service.js';

export const PROPERTY_VERIFICATION_JOB = 'property-verification';

/**
 * Job định kỳ (phase0/02-ARCHITECTURE.md mục 4, TASK-062): mỗi giờ chuyển BĐS quá hạn xác minh sang
 * VERIFY_REQUIRED. Lệnh UPDATE chạy lại an toàn nên nhiều instance cùng chạy không sai dữ liệu; khoá
 * advisory để Phase 18. Môi giới phụ trách được báo qua `PropertyEvents.verificationExpired` (TASK-098).
 */
@Injectable()
export class PropertyVerificationJob {
  private readonly logger = new Logger(PropertyVerificationJob.name);

  constructor(private readonly properties: PropertiesService) {}

  @Cron(CronExpression.EVERY_HOUR, { name: PROPERTY_VERIFICATION_JOB })
  async run(): Promise<void> {
    try {
      const count = await this.properties.markOverdueForVerification();
      if (count > 0) {
        this.logger.log('Đã chuyển BĐS quá hạn xác minh sang VERIFY_REQUIRED', { count });
      }
    } catch (error: unknown) {
      this.logger.error('Job xác minh BĐS lỗi', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
