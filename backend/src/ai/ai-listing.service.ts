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
  MAX_FACEBOOK_HASHTAGS,
  type ListingStyle,
  listingWriterSystemPrompt,
  listingWriterTool,
} from './listing-writer.tool.js';
import { propertyFacts } from './property-facts.js';

/** Tin đăng AI viết (TASK-136). Chỉ là bản nháp: không lưu vào BĐS. */
export interface AiListing {
  property: { id: string; code: string };
  style: ListingStyle;
  title: string;
  description: string;
}

/**
 * Số điện thoại Việt Nam (0xxx hoặc +84xxx, có thể cách bởi khoảng trắng, chấm, gạch; không tính số nằm trong
 * số lớn hơn như 5.000.000.000). Ẩn khỏi mô tả trước khi
 * gửi LLM và khỏi tin AI viết, vì tin để đăng công khai.
 */
const PHONE = /(?<![\d.,])(?:\+84|0)(?:[\s.-]?\d){8,10}(?!\d)/g;
const HIDDEN_PHONE = '[đã ẩn số điện thoại]';

export function hidePhones(text: string): string {
  return text.replace(PHONE, HIDDEN_PHONE);
}

/** Giữ [max] hashtag đầu tiên, bỏ các hashtag sau (bài Facebook, TASK-137). */
export function limitHashtags(text: string, max: number): string {
  let count = 0;
  return text
    .replace(/#[\p{L}\p{N}_]+/gu, (tag) => (++count <= max ? tag : ''))
    .replace(/ {2,}/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

/**
 * AI viết tin đăng từ dữ liệu thật của BĐS (TASK-136, MASTER_PLAN mục 18), cả bài Facebook (TASK-137). Không gửi LLM địa chỉ chi tiết,
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
    const title = clean(input?.['title'], LISTING_TITLE_MAX).replace(/\s+/g, ' ');
    let description = clean(input?.['description'], LISTING_DESCRIPTION_MAX);
    if (style === 'FACEBOOK') {
      description = limitHashtags(description, MAX_FACEBOOK_HASHTAGS);
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
