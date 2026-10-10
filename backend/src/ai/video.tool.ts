import type { LlmTool } from './llm-provider.js';
import { VIDEO_MAX_HIGHLIGHTS } from './video.js';

/** Tool LLM phải gọi để trả chữ trên video (TASK-150). */
export const VIDEO_TOOL = 'property_video';

/** Mỗi dòng chữ trên video tối đa chừng này ký tự để đọc kịp trên điện thoại. */
export const VIDEO_TEXT_MAX = 60;

export const videoTool: LlmTool = {
  name: VIDEO_TOOL,
  description: 'Trả chữ hiển thị trên video giới thiệu bất động sản.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['hook', 'highlights', 'cta'],
    properties: {
      hook: {
        type: 'string',
        description: `Câu mở đầu gây chú ý, tối đa ${VIDEO_TEXT_MAX} ký tự.`,
      },
      highlights: {
        type: 'array',
        maxItems: VIDEO_MAX_HIGHLIGHTS,
        items: { type: 'string', description: `Một điểm nổi bật, tối đa ${VIDEO_TEXT_MAX} ký tự.` },
        description: 'Điểm nổi bật theo thứ tự quan trọng, mỗi cảnh ảnh một điểm.',
      },
      cta: {
        type: 'string',
        description: `Câu mời xem nhà ở cảnh cuối, tối đa ${VIDEO_TEXT_MAX} ký tự.`,
      },
    },
  },
};

export const VIDEO_SYSTEM_PROMPT = `Bạn viết chữ cho video ngắn giới thiệu bất động sản ở Việt Nam, video trình chiếu ảnh thật của BĐS. Người dùng gửi JSON: thông số trong "bat_dong_san", ghi chú môi giới trong "mo_ta" (có thể trống), số cảnh ảnh trong "so_canh_anh". Hãy gọi tool ${VIDEO_TOOL}.

Quy tắc:
- "hook": câu mở đầu ngắn, nêu loại BĐS và khu vực.
- "highlights": đúng "so_canh_anh" điểm nổi bật (ít hơn nếu dữ liệu không đủ), mỗi điểm một cụm ngắn, ví dụ "3 phòng ngủ rộng", "Sổ riêng, công chứng ngay".
- Không ghi giá, diện tích, địa chỉ trong "highlights" (video đã có cảnh thông tin riêng).
- Bạn không xem được ảnh: không mô tả nội dung ảnh, chỉ dùng thông tin có trong JSON. Tiện ích, đặc điểm chỉ lấy từ "mo_ta". Không bịa.
- "cta": lời mời nhắn tin hoặc gọi để xem nhà, không ghi số điện thoại, tên người.
- Mỗi dòng tối đa ${VIDEO_TEXT_MAX} ký tự, tiếng Việt có dấu, không emoji, không hashtag, không markdown.`;
