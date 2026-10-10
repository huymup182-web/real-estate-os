import type { LlmTool } from './llm-provider.js';

/** Tool LLM phải gọi để trả gợi ý chăm sóc có cấu trúc (TASK-141). */
export const FOLLOW_UP_TOOL = 'follow_up_suggestions';

/** Số khách tối đa mỗi lần gợi ý. */
export const FOLLOW_UP_LIMIT = 10;

/** Việc gợi ý môi giới làm với khách. */
export const FOLLOW_UP_ACTIONS = [
  'CALL',
  'MESSAGE',
  'SEND_PROPERTIES',
  'SCHEDULE_VIEWING',
] as const;
export type FollowUpAction = (typeof FOLLOW_UP_ACTIONS)[number];

export const followUpTool: LlmTool = {
  name: FOLLOW_UP_TOOL,
  description: 'Gợi ý việc chăm sóc tiếp theo cho từng khách hàng cần chăm sóc.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['suggestions'],
    properties: {
      suggestions: {
        type: 'array',
        maxItems: FOLLOW_UP_LIMIT,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['ref', 'action', 'reason', 'message'],
          properties: {
            ref: { type: 'string', description: 'Mã khách trong dữ liệu, vd "K1".' },
            action: {
              type: 'string',
              enum: [...FOLLOW_UP_ACTIONS],
              description:
                'CALL gọi điện, MESSAGE nhắn tin, SEND_PROPERTIES gửi BĐS phù hợp, SCHEDULE_VIEWING hẹn đi xem nhà.',
            },
            reason: {
              type: 'string',
              description:
                'Một câu: vì sao nên làm việc này, dựa trên bước, thời gian chưa chăm sóc, hoạt động cuối.',
            },
            message: {
              type: 'string',
              description:
                'Câu mở đầu môi giới có thể nói hoặc nhắn cho khách, xưng "em", gọi "anh/chị".',
            },
          },
        },
      },
    },
  },
};

export const FOLLOW_UP_SYSTEM_PROMPT = `Bạn là trợ lý cho môi giới bất động sản ở Việt Nam. Người dùng gửi danh sách JSON các khách lâu chưa được chăm sóc, mỗi khách có mã "ma" (K1, K2…), bước pipeline, mục đích, thời gian mua, số ngày chưa chăm sóc, số nhu cầu đang bật và hoạt động gần nhất. Hãy gọi tool ${FOLLOW_UP_TOOL} với đúng một gợi ý cho mỗi khách, dùng đúng mã "ma" làm "ref".

Quy tắc:
- Chỉ dựa vào dữ liệu trong JSON, không đoán điều khách chưa nói.
- Khách chưa có nhu cầu đang bật thì nên gọi hoặc nhắn để hỏi nhu cầu, không gửi BĐS.
- Khách đã đi xem, đang thương lượng hoặc đặt cọc thì ưu tiên gọi điện.
- Câu nhắn ngắn, lịch sự, tự nhiên, không hứa giá hay ưu đãi, không dùng emoji, không dùng markdown.`;
