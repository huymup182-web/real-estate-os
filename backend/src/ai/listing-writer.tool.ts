import type { LlmTool } from './llm-provider.js';

/** Tool LLM phải gọi để trả tin đăng có cấu trúc (TASK-136). */
export const LISTING_WRITER_TOOL = 'property_listing';

/** Kiểu tin (MASTER_PLAN mục 18): chuyên nghiệp (đầy đủ) hoặc ngắn gọn. */
export const LISTING_STYLES = ['PROFESSIONAL', 'SHORT'] as const;
export type ListingStyle = (typeof LISTING_STYLES)[number];

/** Cùng giới hạn với `title`, `description` của BĐS (`CreatePropertyDto`), để dán thẳng vào tin. */
export const LISTING_TITLE_MAX = 255;
export const LISTING_DESCRIPTION_MAX = 5000;

export const listingWriterTool: LlmTool = {
  name: LISTING_WRITER_TOOL,
  description: 'Trả tiêu đề và nội dung tin đăng bất động sản.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'description'],
    properties: {
      title: {
        type: 'string',
        description: 'Tiêu đề tin, một dòng, tối đa 120 ký tự, có loại BĐS, khu vực, điểm nổi bật.',
      },
      description: {
        type: 'string',
        description: 'Nội dung tin, chia đoạn bằng xuống dòng, không dùng markdown.',
      },
    },
  },
};

const STYLE_RULES: Record<ListingStyle, string> = {
  PROFESSIONAL:
    'Kiểu chuyên nghiệp: 150–300 từ. Mở đầu bằng điểm nổi bật, sau đó thông số (giá, diện tích, phòng, hướng, pháp lý, đường vào, khu vực) theo từng dòng, cuối cùng một câu mời liên hệ xem nhà.',
  SHORT:
    'Kiểu ngắn gọn: tối đa 60 từ, 3–5 dòng, chỉ nêu giá, diện tích, khu vực và 1–2 điểm nổi bật, cuối cùng một câu mời liên hệ.',
};

export function listingWriterSystemPrompt(style: ListingStyle): string {
  return `Bạn là người viết tin đăng bất động sản cho môi giới ở Việt Nam. Người dùng gửi dữ liệu JSON của một BĐS: thông số trong "bat_dong_san" và ghi chú môi giới đã nhập trong "mo_ta" (có thể trống). Hãy gọi tool ${LISTING_WRITER_TOOL} để viết tiêu đề và nội dung tin đăng.

Quy tắc:
- Chỉ dùng thông tin có trong JSON. Không bịa giá, diện tích, pháp lý, vị trí, tiện ích, quy hoạch hay khoảng cách tới địa điểm nào.
- Giữ đúng số liệu như trong JSON. Trường nào null hoặc không có thì không nhắc tới.
- Tiện ích, đặc điểm chỉ lấy từ "mo_ta".
- Không ghi số điện thoại, tên chủ nhà, địa chỉ số nhà; phần liên hệ chỉ ghi chung, ví dụ "Liên hệ để xem nhà".
- ${STYLE_RULES[style]}
- Viết tiếng Việt có dấu, lịch sự, không phóng đại, không dùng emoji, không dùng markdown.`;
}
