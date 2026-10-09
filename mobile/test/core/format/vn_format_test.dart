import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/format/vn_format.dart';

void main() {
  final now = DateTime.utc(2026, 10, 9, 20); // 03:00 ngày 10/10 giờ Việt Nam.

  test('giờ và ngày theo giờ Việt Nam', () {
    final at = DateTime.utc(2026, 10, 9, 18, 5);
    expect(vnTime(at), '01:05');
    expect(vnDate(at), '10/10/2026');
  });

  test('nhãn ngày so với hôm nay', () {
    expect(vnDayLabel(DateTime.utc(2026, 10, 10, 2), now), 'Hôm nay');
    expect(vnDayLabel(DateTime.utc(2026, 10, 10, 18), now), 'Ngày mai');
    expect(vnDayLabel(DateTime.utc(2026, 10, 9, 10), now), 'Hôm qua');
    expect(vnDayLabel(DateTime.utc(2026, 10, 16, 3), now), 'Thứ 6, 16/10');
    expect(vnDayLabel(DateTime.utc(2026, 10, 18, 3), now), 'Chủ nhật, 18/10');
    expect(vnDayLabel(DateTime.utc(2027, 1, 4, 3), now), 'Thứ 2, 04/01/2027');
  });

  test('số và tiền', () {
    expect(vnNumber(0), '0');
    expect(vnNumber(999), '999');
    expect(vnNumber(1234567), '1.234.567');
    expect(vnNumber(-1000), '-1.000');
    expect(vnMoneyShort(3500000000), '3,5 tỷ');
    expect(vnMoneyShort(12000000000), '12 tỷ');
    expect(vnMoneyShort(850000000), '850 triệu');
    expect(vnMoneyShort(1250000), '1,3 triệu');
    expect(vnMoneyShort(12000), '12.000 đ');
    expect(vnDecimal(70), '70');
    expect(vnDecimal(70.5), '70,5');
    expect(vnDecimal(1250.25), '1.250,25');
    expect(vnDecimal(3.999), '4');
  });
}
