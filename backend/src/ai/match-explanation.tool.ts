import type { LlmTool } from './llm-provider.js';

/** Tool LLM phải gọi để trả lời giải thích matching có cấu trúc (TASK-135). */
export const MATCH_EXPLANATION_TOOL = 'match_explanation';

export const MAX_STRENGTHS = 4;
export const MAX_CONCERNS = 3;

export const matchExplanationTool: LlmTool = {
  name: MATCH_EXPLANATION_TOOL,
  description: 'Giải thích vì sao bất động sản phù hợp hoặc chưa phù hợp với nhu cầu của khách.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'strengths', 'concerns', 'pitch'],
    properties: {
      summary: {
        type: 'string',
        description: 'Một đến hai câu: BĐS hợp với khách ở điểm nào, lệch ở điểm nào.',
      },
      strengths: {
        type: 'array',
        maxItems: MAX_STRENGTHS,
        items: { type: 'string' },
        description: 'Điểm hợp với nhu cầu, mỗi ý một câu ngắn, có số liệu từ dữ liệu.',
      },
      concerns: {
        type: 'array',
        maxItems: MAX_CONCERNS,
        items: { type: 'string' },
        description: 'Điểm lệch so với nhu cầu hoặc cần hỏi thêm khách. Không có thì để mảng rỗng.',
      },
      pitch: {
        type: 'string',
        description: 'Một đến hai câu môi giới có thể nói với khách để giới thiệu BĐS này.',
      },
    },
  },
};

export const MATCH_EXPLANATION_SYSTEM_PROMPT = `Bạn là trợ lý cho môi giới bất động sản ở Việt Nam. Người dùng gửi dữ liệu JSON gồm một BĐS, nhu cầu của khách và điểm phù hợp do hệ thống tính theo từng tiêu chí. Hãy gọi tool ${MATCH_EXPLANATION_TOOL} để giải thích vì sao BĐS này phù hợp với khách.

Quy tắc:
- Chỉ dùng thông tin có trong JSON. Không bịa tiện ích, quy hoạch, giá thị trường hay thông tin không có.
- Giữ đúng số liệu (giá, diện tích, số phòng) như trong JSON.
- Điểm phù hợp do hệ thống tính; không tự chấm lại, không nêu điểm khác.
- Tiêu chí mức đạt dưới 100% là điểm lệch: nêu rõ lệch thế nào trong concerns.
- Tiêu chí khách chưa nêu thì có thể gợi ý môi giới hỏi thêm.
- Viết tiếng Việt, ngắn gọn, lịch sự, không dùng emoji.`;
