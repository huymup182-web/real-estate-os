import {
  DIRECTIONS,
  LEGAL_STATUSES,
  PROPERTY_TYPES,
  ROAD_ACCESSES,
} from '../properties/property-values.js';
import { PROPERTY_SORTS } from '../search/property-search-query.dto.js';
import type { LlmTool } from './llm-provider.js';

/** Tool LLM phải gọi để trả bộ lọc tìm BĐS có cấu trúc (TASK-134). */
export const PROPERTY_SEARCH_TOOL = 'property_search_filter';

/**
 * Các trường LLM điền. Khu vực là tên (LLM không biết id); backend tự đổi tên ra id trong danh mục địa giới.
 * Chỉ gồm bộ lọc app có (không có số phòng ngủ tối đa, phòng tắm, độ rộng đường).
 */
export const propertySearchTool: LlmTool = {
  name: PROPERTY_SEARCH_TOOL,
  description: 'Bộ lọc tìm bất động sản rút ra từ câu người dùng gõ.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['explanation'],
    properties: {
      explanation: {
        type: 'string',
        description: 'Một câu tiếng Việt ngắn nói lại các điều kiện đã hiểu từ câu tìm kiếm.',
      },
      province: { type: 'string', description: 'Tên tỉnh/thành phố trực thuộc trung ương.' },
      ward: {
        type: 'string',
        description: 'Tên phường/xã/đặc khu, chỉ khi người dùng nói rõ đó là phường/xã.',
      },
      place: {
        type: 'string',
        description:
          'Địa danh khác người dùng nêu mà không phải tỉnh hay phường/xã: thành phố, quận/huyện cũ…',
      },
      keyword: {
        type: 'string',
        description:
          'Từ khoá cần có trong tiêu đề/mô tả/địa chỉ (tên đường, dự án, đặc điểm). Bỏ trống nếu không có.',
      },
      priceMin: { type: 'integer', minimum: 0, description: 'Giá thấp nhất, đồng.' },
      priceMax: { type: 'integer', minimum: 0, description: 'Giá cao nhất, đồng.' },
      areaMin: { type: 'number', minimum: 0, description: 'Diện tích nhỏ nhất, m².' },
      areaMax: { type: 'number', minimum: 0, description: 'Diện tích lớn nhất, m².' },
      propertyType: { type: 'array', items: { enum: [...PROPERTY_TYPES] } },
      bedroomsMin: { type: 'integer', minimum: 0, description: 'Số phòng ngủ ít nhất.' },
      legalStatus: { type: 'array', items: { enum: [...LEGAL_STATUSES] } },
      direction: { type: 'array', items: { enum: [...DIRECTIONS] } },
      roadAccess: { type: 'array', items: { enum: [...ROAD_ACCESSES] } },
      sort: { enum: [...PROPERTY_SORTS] },
    },
  },
};

export const PROPERTY_SEARCH_SYSTEM_PROMPT = `Bạn chuyển câu tìm bất động sản (thị trường Việt Nam) thành bộ lọc bằng cách gọi tool ${PROPERTY_SEARCH_TOOL}. Bạn không truy cập dữ liệu; backend sẽ tìm.

Quy tắc:
- Chỉ điền điều kiện người dùng nói ra, không tự thêm. Không chắc thì bỏ trống.
- Tiền: 1 tỷ = 1000000000 đồng, 1 triệu = 1000000 đồng. "khoảng X" → priceMin = 90% X, priceMax = 110% X. "dưới X", "tối đa X" → priceMax = X. "trên X", "từ X" → priceMin = X. "từ X đến Y" → priceMin = X, priceMax = Y.
- Diện tích theo m², cùng cách hiểu "khoảng/dưới/trên" như giá.
- "N phòng ngủ", "N PN" → bedroomsMin = N.
- propertyType: HOUSE = nhà phố, nhà riêng; APARTMENT = căn hộ, chung cư; VILLA = biệt thự; SHOPHOUSE; LAND = đất thổ cư; LAND_PLOT = đất nền; AGRICULTURAL_LAND = đất nông nghiệp, vườn; WAREHOUSE = kho, xưởng. "nhà" chung chung không kèm loại → HOUSE.
- legalStatus: PRIVATE_BOOK = sổ riêng, sổ hồng/sổ đỏ riêng; SHARED_BOOK = sổ chung; PENDING_BOOK = chờ sổ; SALE_CONTRACT = hợp đồng mua bán, góp vốn; HANDWRITTEN = giấy tay, vi bằng.
- direction: N Bắc, S Nam, E Đông, W Tây, NE Đông Bắc, NW Tây Bắc, SE Đông Nam, SW Tây Nam.
- roadAccess: "ô tô vào được", "hẻm xe hơi", "mặt tiền" → [CAR]; "xe máy vào được" → [CAR, MOTORBIKE].
- sort: "rẻ nhất" → price_asc, "đắt nhất" → price_desc, "rộng nhất" → area_desc, "mới nhất" → newest.
- Khu vực: tên tỉnh/thành vào province; phường/xã vào ward; thành phố, quận/huyện cũ (vd "Nha Trang") vào place, và điền luôn province nếu chắc chắn tỉnh của nó.
- explanation viết tiếng Việt, một câu, nêu các điều kiện đã hiểu.`;
