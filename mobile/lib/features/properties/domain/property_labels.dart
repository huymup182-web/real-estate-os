/// Nhãn tiếng Việt cho giá trị BĐS (khớp backend `src/properties/property-values.ts`, web admin
/// `lib/properties.ts`). Giá trị lạ thì hiện nguyên mã.
const propertyTypeLabels = {
  'HOUSE': 'Nhà phố, nhà riêng',
  'APARTMENT': 'Căn hộ',
  'VILLA': 'Biệt thự',
  'SHOPHOUSE': 'Shophouse',
  'LAND': 'Đất thổ cư',
  'LAND_PLOT': 'Đất nền',
  'AGRICULTURAL_LAND': 'Đất nông nghiệp, vườn',
  'WAREHOUSE': 'Kho, xưởng',
  'OTHER': 'Khác',
};

const propertyStatusLabels = {
  'AVAILABLE': 'Đang bán',
  'PENDING': 'Đang giao dịch',
  'SOLD': 'Đã bán',
  'HIDDEN': 'Đã ẩn',
  'EXPIRED': 'Hết hạn',
  'VERIFY_REQUIRED': 'Cần xác minh',
};

const legalStatusLabels = {
  'PRIVATE_BOOK': 'Sổ riêng',
  'SHARED_BOOK': 'Sổ chung',
  'PENDING_BOOK': 'Chờ cấp sổ',
  'SALE_CONTRACT': 'HĐ mua bán, góp vốn',
  'HANDWRITTEN': 'Giấy tay, vi bằng',
  'OTHER': 'Khác',
};

const directionLabels = {
  'N': 'Bắc',
  'S': 'Nam',
  'E': 'Đông',
  'W': 'Tây',
  'NE': 'Đông Bắc',
  'NW': 'Tây Bắc',
  'SE': 'Đông Nam',
  'SW': 'Tây Nam',
};

const roadAccessLabels = {
  'CAR': 'Ô tô vào được',
  'MOTORBIKE': 'Xe máy',
  'WALK': 'Đi bộ',
};

const verificationLabels = {
  'UNVERIFIED': 'Chưa xác minh',
  'VERIFIED': 'Đã xác minh',
  'EXPIRED': 'Hết hạn xác minh',
};

/// Cách sắp xếp `GET /properties?sort=` (không gồm `relevance`: đó là mặc định khi có từ khoá).
const propertySortLabels = {
  'newest': 'Mới nhất',
  'price_asc': 'Giá tăng dần',
  'price_desc': 'Giá giảm dần',
  'area_asc': 'Diện tích tăng dần',
  'area_desc': 'Diện tích giảm dần',
};

String labelOf(Map<String, String> labels, String value) =>
    labels[value] ?? value;
