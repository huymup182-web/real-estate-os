import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/access-token.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import {
  type Actor,
  PropertiesService,
  type PropertyScopes,
} from '../properties/properties.service.js';
import { AiGatewayService } from './ai-gateway.service.js';
import {
  LISTING_DESCRIPTION_MAX,
  LISTING_FEATURES,
  LISTING_TITLE_MAX,
  LISTING_WRITER_TOOL,
  MAX_HASHTAGS,
  MAX_TITLE_HASHTAGS,
  type ListingStyle,
  listingWriterSystemPrompt,
  listingWriterTool,
} from './listing-writer.tool.js';
import { propertyFacts } from './property-facts.js';
import { hidePhones } from './redact.js';

/** Tin đăng AI viết (TASK-136). Chỉ là bản nháp: không lưu vào BĐS. */
export interface AiListing {
  property: { id: string; code: string };
  style: ListingStyle;
  title: string;
  description: string;
}

/** Giữ [max] hashtag đầu tiên, bỏ các hashtag sau (bài Facebook TASK-137, tin Zalo TASK-138, TikTok TASK-139). */
export function limitHashtags(text: string, max: number): string {
  let count = 0;
  return text
    .replace(/#[\p{L}\p{N}_]+/gu, (tag) => (++count <= max ? tag : ''))
    .replace(/ {2,}/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

/**
 * AI viết tin đăng từ dữ liệu thật của BĐS (TASK-136, MASTER_PLAN mục 18), cả bài Facebook (TASK-137), tin Zalo (TASK-138), kịch bản TikTok (TASK-139). Không gửi LLM địa chỉ chi tiết,
 * chủ nhà, môi giới, hoa hồng; mô tả gửi kèm đã ẩn số điện thoại.
 */
@Injectable()
export class AiListingService {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly properties: PropertiesService,
  ) {}

  async write(
    user: AuthenticatedUser,
    actor: Actor,
    propertyId: string,
    scopes: PropertyScopes,
    style: ListingStyle,
  ): Promise<AiListing> {
    const property = await this.properties.findOne(actor, propertyId, scopes);
    const facts = {
      bat_dong_san: propertyFacts(property),
      mo_ta: property.description ? hidePhones(property.description) : null,
    };

    const response = await this.gateway.complete(user, {
      feature: LISTING_FEATURES[style],
      system: listingWriterSystemPrompt(style),
      messages: [{ role: 'user', content: JSON.stringify(facts) }],
      tools: [listingWriterTool],
      forceTool: LISTING_WRITER_TOOL,
      maxTokens: 2048,
    });
    const input = response.toolCalls.find((call) => call.name === LISTING_WRITER_TOOL)?.input;
    let title = clean(input?.['title'], LISTING_TITLE_MAX).replace(/\s+/g, ' ');
    const maxTitleHashtags = MAX_TITLE_HASHTAGS[style];
    if (maxTitleHashtags !== undefined) {
      title = limitHashtags(title, maxTitleHashtags);
    }
    let description = clean(input?.['description'], LISTING_DESCRIPTION_MAX);
    const maxHashtags = MAX_HASHTAGS[style];
    if (maxHashtags !== undefined) {
      description = limitHashtags(description, maxHashtags);
    }
    if (title === '' || description === '') {
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'AI chưa viết được tin đăng, vui lòng thử lại',
      );
    }
    return { property: { id: property.id, code: property.code }, style, title, description };
  }
}

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? hidePhones(value).trim().slice(0, max).trim() : '';
}
