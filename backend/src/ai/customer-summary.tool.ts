import type { LlmTool } from './llm-provider.js';

/** Tool LLM phải gọi để trả tóm tắt khách có cấu trúc (TASK-140). */
export const CUSTOMER_SUMMARY_TOOL = 'customer_summary';

export const MAX_KEY_POINTS = 5;
export const MAX_OPEN_QUESTIONS = 3;
/** Số hoạt động gần nhất gửi LLM. */
export const SUMMARY_ACTIVITY_LIMIT = 30;

export const customerSummaryTool: LlmTool = {
  name: CUSTOMER_SUMMARY_TOOL,
  description: 'Tóm tắt nhu cầu và lịch sử chăm sóc của một khách hàng bất động sản.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'keyPoints', 'openQuestions'],
    properties: {
      summary: {
        type: 'string',
        description:
          'Hai đến bốn câu: khách cần gì, đang ở bước nào, lần chăm sóc gần nhất là gì và khi nào.',
      },
      keyPoints: {
        type: 'array',
        maxItems: MAX_KEY_POINTS,
        items: { type: 'string' },
        description: 'Ý chính về nhu cầu, phản hồi, mối quan tâm của khách, mỗi ý một câu ngắn.',
      },
      openQuestions: {
        type: 'array',
        maxItems: MAX_OPEN_QUESTIONS,
        items: { type: 'string' },
        description:
          'Thông tin còn thiếu môi giới nên hỏi khách (vd ngân sách, khu vực). Không có thì để mảng rỗng.',
      },
    },
  },
};

export const CUSTOMER_SUMMARY_SYSTEM_PROMPT = `Bạn là trợ lý cho môi giới bất động sản ở Việt Nam. Người dùng gửi dữ liệu JSON về một khách hàng: thông tin chung trong "khach_hang", nhu cầu trong "nhu_cau", các hoạt động chăm sóc theo thứ tự thời gian trong "hoat_dong" (tối đa ${SUMMARY_ACTIVITY_LIMIT} hoạt động gần nhất) và ngày hôm nay trong "hom_nay". Hãy gọi tool ${CUSTOMER_SUMMARY_TOOL} để tóm tắt khách cho môi giới.

Quy tắc:
- Chỉ dùng thông tin có trong JSON. Không đoán tên, tuổi, nghề nghiệp, thu nhập hay điều khách không nói.
- Giữ đúng số liệu và ngày như trong JSON. Nói "khách", không đặt tên cho khách.
- Nhu cầu "dang_bat" là false là nhu cầu đã tạm dừng: chỉ nhắc nếu có ích.
- Nêu rõ lần chăm sóc gần nhất cách hôm nay bao lâu.
- Viết tiếng Việt, ngắn gọn, khách quan, không dùng emoji, không dùng markdown.`;
