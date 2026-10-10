import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { APP_CONFIG } from '../config/app-config.module.js';
import type { AppConfig } from '../config/app-config.js';
import { AiController } from './ai.controller.js';
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
 */
@Module({
  imports: [AuthModule],
  controllers: [AiController],
  providers: [
    AiGatewayService,
    AiPropertySearchService,
    { provide: LLM_PROVIDER, inject: [APP_CONFIG], useFactory: llmProviderFor },
  ],
  exports: [AiGatewayService],
})
export class AiModule {}
