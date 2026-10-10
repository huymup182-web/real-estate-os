import type { LlmTool } from './llm-provider.js';

/** Tool LLM phải gọi để trả gợi ý chốt giao dịch có cấu trúc (TASK-142). */
export const SALES_ASSISTANT_TOOL = 'sales_assistant';

export const MAX_NEXT_STEPS = 4;
export const MAX_TALKING_POINTS = 4;
export const MAX_RISKS = 3;
/** Số hoạt động gần nhất của khách gửi LLM. */
export const SALES_ACTIVITY_LIMIT = 10;

const list = (description: string, maxItems: number) => ({
  type: 'array',
  maxItems,
  items: { type: 'string' },
  description,
});

export const salesAssistantTool: LlmTool = {
  name: SALES_ASSISTANT_TOOL,
  description: 'Gợi ý cho môi giới cách đưa một giao dịch bất động sản tới bước tiếp theo.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['situation', 'nextSteps', 'talkingPoints', 'risks'],
    properties: {
      situation: {
        type: 'string',
        description:
          'Hai đến ba câu: giao dịch đang ở đâu, đã có gì (giá chốt, cọc), còn thiếu gì.',
      },
      nextSteps: list(
        'Việc cụ thể môi giới nên làm để sang bước tiếp theo, theo thứ tự ưu tiên.',
        MAX_NEXT_STEPS,
      ),
      talkingPoints: list(
        'Ý môi giới có thể nói với khách để thuyết phục, chỉ dựa trên dữ liệu BĐS và nhu cầu.',
        MAX_TALKING_POINTS,
      ),
      risks: list(
        'Rủi ro cần lưu ý (pháp lý, giá so với ngân sách, lâu chưa liên hệ). Không có thì để mảng rỗng.',
        MAX_RISKS,
      ),
    },
  },
};

export const SALES_ASSISTANT_SYSTEM_PROMPT = `Bạn là trợ lý bán hàng cho môi giới bất động sản ở Việt Nam. Người dùng gửi dữ liệu JSON của một giao dịch: thông tin giao dịch trong "giao_dich", BĐS trong "bat_dong_san", khách trong "khach_hang" (bước, nhu cầu, hoạt động gần nhất; có thể null khi người hỏi không có quyền xem) và ngày hôm nay trong "hom_nay". Hãy gọi tool ${SALES_ASSISTANT_TOOL} để gợi ý cách đưa giao dịch tới bước tiếp theo.

Các bước giao dịch theo thứ tự: Đang thương lượng → Đặt cọc → Hợp đồng → Thành công (hoặc Thất bại).

Quy tắc:
- Chỉ dùng thông tin có trong JSON. Không bịa giá thị trường, quy hoạch, tiện ích, chính sách ngân hàng hay quy định pháp luật cụ thể.
- Giữ đúng số liệu như trong JSON. Nói "khách", "chủ nhà", không đặt tên.
- Giao dịch đã Thành công hoặc Thất bại: tóm tắt và gợi ý việc sau giao dịch (chăm sóc khách cũ, xin giới thiệu, rút kinh nghiệm).
- Không gợi ý ép giá, hứa hẹn sai sự thật hay làm trái pháp luật.
- Viết tiếng Việt, ngắn gọn, thực tế, không dùng emoji, không dùng markdown.`;
