import type { LlmTool } from './llm-provider.js';

/** Tool LLM phải gọi để trả mức chỉnh giá và lý do (TASK-149). */
export const VALUATION_TOOL = 'property_valuation';

export const VALUATION_IMPACTS = ['UP', 'DOWN', 'NEUTRAL'] as const;
export type ValuationImpact = (typeof VALUATION_IMPACTS)[number];

export const VALUATION_MAX_FACTORS = 6;
export const VALUATION_FACTOR_MAX = 80;
export const VALUATION_NOTE_MAX = 200;
export const VALUATION_SUMMARY_MAX = 600;

export function valuationTool(maxAdjustment: number): LlmTool {
  return {
    name: VALUATION_TOOL,
    description: 'Trả mức chỉnh giá gốc, các yếu tố ảnh hưởng và nhận xét định giá.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['adjustmentPercent', 'factors', 'summary'],
      properties: {
        adjustmentPercent: {
          type: 'number',
          minimum: -maxAdjustment,
          maximum: maxAdjustment,
          description: `Phần trăm chỉnh giá gốc, từ -${maxAdjustment} đến ${maxAdjustment}; 0 nếu không có lý do rõ ràng.`,
        },
        factors: {
          type: 'array',
          maxItems: VALUATION_MAX_FACTORS,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['factor', 'impact', 'note'],
            properties: {
              factor: { type: 'string', description: 'Tên yếu tố, ví dụ "Pháp lý", "Đường vào".' },
              impact: { type: 'string', enum: [...VALUATION_IMPACTS] },
              note: { type: 'string', description: 'Một câu giải thích, dựa trên dữ liệu đã cho.' },
            },
          },
        },
        summary: {
          type: 'string',
          description: 'Nhận xét 2–4 câu về giá ước tính, không dùng markdown.',
        },
      },
    },
  };
}

export function valuationSystemPrompt(maxAdjustment: number): string {
  return `Bạn là chuyên viên thẩm định giá bất động sản ở Việt Nam. Người dùng gửi JSON gồm BĐS cần định giá ("bat_dong_san", ghi chú môi giới trong "mo_ta"), các BĐS tương tự cùng khu vực ("bds_tuong_tu") và giá gốc đã tính từ giá/m² trung vị của chúng ("gia_goc"). Hãy gọi tool ${VALUATION_TOOL}.

Quy tắc:
- So sánh BĐS cần định giá với các BĐS tương tự theo pháp lý, hướng, đường vào, độ rộng đường, số tầng, số phòng, diện tích, trạng thái (đã bán phản ánh giá giao dịch thật hơn tin đang bán).
- "adjustmentPercent" chỉnh giá gốc trong khoảng ±${maxAdjustment}%. Chỉ chỉnh khi có khác biệt rõ ràng trong dữ liệu; không chắc thì để 0.
- Chỉ dùng thông tin có trong JSON, không bịa quy hoạch, tiện ích, khoảng cách hay giá thị trường bên ngoài.
- "factors" nêu tối đa ${VALUATION_MAX_FACTORS} yếu tố ảnh hưởng, mỗi yếu tố một câu ngắn.
- "summary" nói giá ước tính dựa trên bao nhiêu BĐS tương tự và lưu ý chính; không ghi số điện thoại, tên người.
- Viết tiếng Việt có dấu, khách quan, không dùng markdown.`;
}
