import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/features/customers/domain/customer_detail.dart';
import 'package:real_estate_os/features/customers/domain/preference_summary.dart';

void main() {
  const names = {'kh': 'Khánh Hòa', 'ld': 'Lâm Đồng'};

  test(
    'đủ tiêu chí: loại giao dịch, loại BĐS, ngân sách, diện tích, PN, tỉnh',
    () {
      const preference = CustomerPreference(
        id: 'p1',
        transactionType: 'SALE',
        isActive: true,
        propertyTypes: ['APARTMENT', 'LAND_PLOT'],
        budgetMin: 2000000000,
        budgetMax: 3500000000,
        areaMin: 60,
        bedroomsMin: 2,
        provinceIds: ['kh', 'unknown', 'ld'],
      );
      expect(
        preferenceSummary(preference, names),
        'Mua · Căn hộ, Đất nền · 2 tỷ – 3,5 tỷ · từ 60 m² · từ 2 PN · Khánh Hòa, Lâm Đồng',
      );
    },
  );

  test('chỉ có cận trên; tiêu chí trống thì bỏ', () {
    const preference = CustomerPreference(
      id: 'p2',
      transactionType: 'RENT',
      isActive: true,
      budgetMax: 15000000,
      areaMax: 45.5,
    );
    expect(
      preferenceSummary(preference, names),
      'Thuê · đến 15 triệu · đến 45,5 m²',
    );
  });
}
