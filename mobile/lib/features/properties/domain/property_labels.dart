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

String labelOf(Map<String, String> labels, String value) =>
    labels[value] ?? value;
