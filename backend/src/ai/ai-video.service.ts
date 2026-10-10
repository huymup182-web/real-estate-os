import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/access-token.service.js';
import { AppException } from '../common/errors/app.exception.js';
import { ErrorCode } from '../common/errors/error-code.js';
import {
  type Actor,
  PropertiesService,
  type PropertyScopes,
} from '../properties/properties.service.js';
import { PropertyImagesService } from '../properties/property-images.service.js';
import { AiGatewayService } from './ai-gateway.service.js';
import { LEGAL_STATUS_LABELS, propertyFacts, vnArea, vnMoney } from './property-facts.js';
import { hidePhones } from './redact.js';
import { VIDEO_MAX_HIGHLIGHTS, type VideoDuration, type VideoScene, buildScenes } from './video.js';
import { VIDEO_SYSTEM_PROMPT, VIDEO_TEXT_MAX, VIDEO_TOOL, videoTool } from './video.tool.js';

/** Video AI dùng tối đa chừng này ảnh đầu tiên của BĐS. */
const VIDEO_MAX_IMAGES = 8;
/** Ghi chú môi giới gửi LLM tối đa chừng này ký tự. */
const DESCRIPTION_MAX = 2000;

/** Kịch bản video AI (TASK-150): app phát các cảnh theo thứ tự. Không lưu vào BĐS. */
export interface AiVideo {
  property: { id: string; code: string };
  durationSeconds: number;
  scenes: VideoScene[];
}

function clean(value: unknown): string {
  return typeof value === 'string'
    ? hidePhones(value)
        .replace(/#[\p{L}\p{N}_]+/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, VIDEO_TEXT_MAX)
        .trim()
    : '';
}

/**
 * Video AI từ ảnh và dữ liệu thật của BĐS (TASK-150, MASTER_PLAN mục 19): AI chỉ viết câu mở đầu, điểm nổi bật và
 * lời mời; giá, diện tích, khu vực do backend ghi từ database. Không gửi LLM địa chỉ chi tiết, chủ nhà, môi giới,
 * hoa hồng, ảnh; mô tả gửi kèm đã ẩn số điện thoại.
 */
@Injectable()
export class AiVideoService {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly properties: PropertiesService,
    private readonly images: PropertyImagesService,
  ) {}

  async create(
    user: AuthenticatedUser,
    actor: Actor,
    propertyId: string,
    scopes: PropertyScopes,
    durationSeconds: VideoDuration,
  ): Promise<AiVideo> {
    const property = await this.properties.findOne(actor, propertyId, scopes);
    const images = (await this.images.findAll(actor, propertyId, scopes)).slice(
      0,
      VIDEO_MAX_IMAGES,
    );
    if (images.length === 0) {
      throw new AppException(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        'BĐS chưa có ảnh, hãy thêm ảnh trước khi tạo video',
      );
    }
    const imageScenes = Math.min(
      VIDEO_MAX_HIGHLIGHTS,
      Math.max(images.length - 1, 1),
      Math.floor(durationSeconds / 3) - 3,
    );

    const response = await this.gateway.complete(user, {
      feature: 'video',
      system: VIDEO_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            bat_dong_san: propertyFacts(property),
            mo_ta: property.description
              ? hidePhones(property.description).slice(0, DESCRIPTION_MAX)
              : null,
            so_canh_anh: imageScenes,
          }),
        },
      ],
      tools: [videoTool],
      forceTool: VIDEO_TOOL,
      maxTokens: 1024,
    });
    const input = response.toolCalls.find((call) => call.name === VIDEO_TOOL)?.input;
    const hook = clean(input?.['hook']);
    const cta = clean(input?.['cta']);
    if (hook === '' || cta === '') {
      throw new AppException(
        ErrorCode.SERVICE_UNAVAILABLE,
        'AI chưa viết được kịch bản video, vui lòng thử lại',
      );
    }
    const rawHighlights: unknown = input?.['highlights'];
    const highlights = (Array.isArray(rawHighlights) ? rawHighlights : [])
      .map(clean)
      .filter((text) => text !== '')
      .slice(0, imageScenes);

    const legal = property.legalStatus ? LEGAL_STATUS_LABELS[property.legalStatus] : undefined;
    const facts = [
      `Giá ${vnMoney(property.price)}`,
      `Diện tích ${vnArea(property.area)}`,
      ...(property.bedrooms ? [`${property.bedrooms} phòng ngủ`] : []),
      ...(legal ? [legal] : []),
      `${property.wardName}, ${property.provinceName}`,
    ];
    return {
      property: { id: property.id, code: property.code },
      durationSeconds,
      scenes: buildScenes(
        images.map((image) => ({ id: image.id, url: image.url })),
        durationSeconds,
        { hook, highlights, cta, facts },
      ),
    };
  }
}
