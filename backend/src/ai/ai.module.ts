import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { APP_CONFIG } from '../config/app-config.module.js';
import type { AppConfig } from '../config/app-config.js';
import { MatchingModule } from '../matching/matching.module.js';
import { PropertiesModule } from '../properties/properties.module.js';
import { AiController } from './ai.controller.js';
import { AiCustomerController } from './ai-customer.controller.js';
import { AiCustomerSummaryService } from './ai-customer-summary.service.js';
import { AiFollowUpService } from './ai-follow-up.service.js';
import { AiListingController } from './ai-listing.controller.js';
import { AiListingService } from './ai-listing.service.js';
import { AiMatchExplanationService } from './ai-match-explanation.service.js';
import { AiMatchingController } from './ai-matching.controller.js';
import { AiGatewayService, LLM_PROVIDER } from './ai-gateway.service.js';
import { AiPropertySearchService } from './ai-property-search.service.js';
import { AnthropicProvider } from './anthropic.provider.js';
import type { LlmProvider } from './llm-provider.js';

/** Có AI_API_KEY thì tạo adapter theo AI_PROVIDER, không thì AI tắt. */
export function llmProviderFor(config: AppConfig): LlmProvider | null {
  if (!config.ai) {
    return null;
  }
  switch (config.ai.provider) {
    case 'anthropic':
      return new AnthropicProvider(config.ai);
  }
}

/**
 * Module AI (phase0/02-ARCHITECTURE.md mục 8). TASK-133: AI gateway `AiGatewayService` dùng chung cho các
 * tính năng AI sau này, bảng `ai_requests` ghi mỗi lượt gọi, API `/ai/status`.
 * TASK-134: tìm BĐS bằng câu tự nhiên `POST /ai/property-search` (`AiPropertySearchService`).
 * TASK-135: AI giải thích matching khách ↔ BĐS (`AiMatchExplanationService`).
 * TASK-136: AI viết tin đăng `POST /properties/:id/ai-listing` (`AiListingService`); TASK-137..139 thêm kiểu
 * Facebook, Zalo, TikTok.
 * TASK-140: AI tóm tắt khách `POST /customers/:id/ai-summary` (`AiCustomerSummaryService`).
 * TASK-141: AI gợi ý chăm sóc `POST /ai/follow-ups` (`AiFollowUpService`).
 */
@Module({
  imports: [AuthModule, CustomersModule, MatchingModule, PropertiesModule],
  controllers: [AiController, AiMatchingController, AiListingController, AiCustomerController],
  providers: [
    AiGatewayService,
    AiPropertySearchService,
    AiMatchExplanationService,
    AiListingService,
    AiCustomerSummaryService,
    AiFollowUpService,
    { provide: LLM_PROVIDER, inject: [APP_CONFIG], useFactory: llmProviderFor },
  ],
  exports: [AiGatewayService],
})
export class AiModule {}
