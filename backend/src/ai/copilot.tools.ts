import type { LlmTool } from './llm-provider.js';
import { propertySearchTool } from './property-search.tool.js';

/** Tool Copilot (TASK-143). Backend chạy từng tool qua service layer với quyền, phạm vi, tenant của user. */
export const COPILOT_TOOLS = {
  searchProperties: 'search_properties',
  getProperty: 'get_property',
  currentCustomer: 'current_customer',
  matchingProperties: 'matching_properties',
  followUpCustomers: 'follow_up_customers',
} as const;

/** Số BĐS tối đa mỗi lần tìm / gợi ý trả LLM. */
export const COPILOT_PROPERTY_LIMIT = 5;
/** Số lần tối đa LLM được gọi tool trong một câu hỏi; lần sau đó LLM phải trả lời. */
export const COPILOT_TOOL_ROUNDS = 3;
/** Số tool tối đa backend chạy trong một lần LLM gọi tool. */
export const COPILOT_TOOL_CALLS_PER_ROUND = 4;

/** Cùng bộ lọc với tìm BĐS bằng câu tự nhiên (TASK-134), bỏ câu giải thích. */
const searchProperties = Object.fromEntries(
  Object.entries(propertySearchTool.inputSchema['properties'] as Record<string, unknown>).filter(
    ([key]) => key !== 'explanation',
  ),
);

const noInput = { type: 'object', additionalProperties: false, properties: {} };

export const searchPropertiesTool: LlmTool = {
  name: COPILOT_TOOLS.searchProperties,
  description: `Tìm BĐS người dùng xem được theo bộ lọc. Trả tối đa ${COPILOT_PROPERTY_LIMIT} BĐS: mã, thông số, số ngày đã đăng.`,
  inputSchema: { type: 'object', additionalProperties: false, properties: searchProperties },
};

export const getPropertyTool: LlmTool = {
  name: COPILOT_TOOLS.getProperty,
  description:
    'Xem thông số và mô tả của một BĐS theo mã (vd mã BĐS đang xem hoặc mã trong kết quả tìm).',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['code'],
    properties: { code: { type: 'string', description: 'Mã BĐS, vd "BDS-000123".' } },
  },
};

export const currentCustomerTool: LlmTool = {
  name: COPILOT_TOOLS.currentCustomer,
  description:
    'Xem khách người dùng đang mở: bước pipeline, mục đích, nhu cầu, ghi chú và lịch sử chăm sóc gần nhất.',
  inputSchema: noInput,
};

export const matchingPropertiesTool: LlmTool = {
  name: COPILOT_TOOLS.matchingProperties,
  description: `BĐS phù hợp nhất với nhu cầu của khách đang mở, điểm phù hợp do hệ thống chấm. Tối đa ${COPILOT_PROPERTY_LIMIT} BĐS.`,
  inputSchema: noInput,
};

export const followUpCustomersTool: LlmTool = {
  name: COPILOT_TOOLS.followUpCustomers,
  description:
    'Khách cần chăm sóc hôm nay (lâu chưa có hoạt động), khách gần chốt trước. Mỗi khách có mã K1, K2…',
  inputSchema: noInput,
};

/** Ngữ cảnh màn hình người dùng mở Copilot. */
export interface CopilotPromptContext {
  today: string;
  propertyCode: string | null;
  hasCustomer: boolean;
}

export function copilotSystemPrompt(context: CopilotPromptContext): string {
  const screen = [
    context.propertyCode
      ? `- Người dùng đang xem BĐS mã ${context.propertyCode}; "căn này", "BĐS này" là BĐS đó.`
      : null,
    context.hasCustomer
      ? `- Người dùng đang xem một khách hàng; "khách này" là khách đó (tool ${COPILOT_TOOLS.currentCustomer}).`
      : null,
  ].filter((line) => line !== null);
  return `Bạn là Copilot cho môi giới bất động sản ở Việt Nam, trong app quản lý BĐS và khách hàng. Hôm nay là ${context.today}.
${screen.length > 0 ? `\nNgữ cảnh:\n${screen.join('\n')}\n` : ''}
Quy tắc:
- Bạn không truy cập database. Muốn biết dữ liệu thì gọi tool; chỉ dùng dữ liệu tool trả về, không bịa BĐS, giá, khách hay tiện ích.
- Chỉ có tool được liệt kê; người dùng không có quyền thì không có tool đó. Không làm được thì nói rõ.
- Mã khách K1, K2… chỉ đúng trong câu trả lời này; câu hỏi sau cần thì gọi lại tool. App tự hiện tên khách theo mã.
- Không có dữ liệu thương lượng giá. Hỏi "căn nào dễ thương lượng" thì chỉ ước đoán từ số ngày đã đăng và giá/m² so với các căn khác trong kết quả, và nói rõ đó là ước đoán.
- Viết tin đăng thì dùng thông số từ tool, không thêm số điện thoại.
- Trả lời tiếng Việt, ngắn gọn, dễ đọc trên điện thoại; nêu mã BĐS khi nhắc tới một căn. Không dùng bảng markdown.`;
}
