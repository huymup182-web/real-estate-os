import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/features/properties/domain/property_query.dart';

void main() {
  const full = PropertyQuery(
    keyword: 'nha pho',
    sort: 'price_asc',
    propertyTypes: {'VILLA', 'HOUSE'},
    priceMin: 2500000000,
    priceMax: 6000000000,
    areaMin: 70.5,
    areaMax: 100,
    provinceId: 'kh',
    wardId: 'kh-vh',
    bedroomsMin: 3,
    legalStatuses: {'PRIVATE_BOOK'},
    directions: {'SE', 'E'},
  );

  test('toQueryParameters: đủ tham số, danh sách nối dấu phẩy theo thứ tự', () {
    expect(full.toQueryParameters(), {
      'q': 'nha pho',
      'propertyType': 'HOUSE,VILLA',
      'priceMin': 2500000000,
      'priceMax': 6000000000,
      'areaMin': '70.5',
      'areaMax': '100',
      'provinceId': 'kh',
      'wardId': 'kh-vh',
      'bedroomsMin': 3,
      'legalStatus': 'PRIVATE_BOOK',
      'direction': 'E,SE',
      'sort': 'price_asc',
    });
    expect(const PropertyQuery().toQueryParameters(), isEmpty);
  });

  test('filterCount đếm nhóm, không đếm từ khoá; giá từ + đến là một nhóm', () {
    expect(full.filterCount, 8);
    expect(const PropertyQuery(keyword: 'a').filterCount, 0);
    expect(const PropertyQuery(keyword: 'a').isEmpty, isFalse);
    expect(const PropertyQuery(priceMax: 1).filterCount, 1);
    expect(const PropertyQuery().isEmpty, isTrue);
  });

  test(
    'đổi từ khoá giữ bộ lọc; áp bộ lọc giữ từ khoá; xoá lọc giữ từ khoá',
    () {
      final renamed = full.withKeyword('  can ho ');
      expect(renamed.keyword, 'can ho');
      expect(renamed.withKeyword('nha pho'), full);

      final filtered = const PropertyQuery(keyword: 'x')
          .withFilters(const PropertyQuery(keyword: 'bỏ qua', bedroomsMin: 2));
      expect(filtered, const PropertyQuery(keyword: 'x', bedroomsMin: 2));

      expect(full.withoutFilters(), const PropertyQuery(keyword: 'nha pho'));
    },
  );

  test('phường không có tỉnh thì bỏ', () {
    expect(
      const PropertyQuery().withFilters(const PropertyQuery(wardId: 'kh-vh')),
      const PropertyQuery(),
    );
  });

  test('so sánh tập không phụ thuộc thứ tự', () {
    const a = PropertyQuery(propertyTypes: {'HOUSE', 'VILLA'});
    const b = PropertyQuery(propertyTypes: {'VILLA', 'HOUSE'});
    expect(a, b);
    expect(a.hashCode, b.hashCode);
    expect(a == const PropertyQuery(propertyTypes: {'HOUSE'}), isFalse);
  });

  test('parseDecimalInput: phẩy hoặc chấm, giới hạn chữ số sau dấu', () {
    expect(parseDecimalInput(' 3,5 '), 3.5);
    expect(parseDecimalInput('3.25'), 3.25);
    expect(parseDecimalInput('12'), 12);
    expect(parseDecimalInput(''), isNull);
    expect(parseDecimalInput('1,255', decimals: 3), 1.255);
    expect(() => parseDecimalInput('1,255'), throwsFormatException);
    expect(() => parseDecimalInput('1,2,3'), throwsFormatException);
    expect(() => parseDecimalInput(','), throwsFormatException);
  });
}
