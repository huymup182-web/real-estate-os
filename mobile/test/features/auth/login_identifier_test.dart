import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/features/auth/domain/login_identifier.dart';

void main() {
  test('email giữ nguyên, bỏ khoảng trắng hai đầu', () {
    expect(normalizeLoginIdentifier('  An@Demo.vn '), 'An@Demo.vn');
    expect(normalizeLoginIdentifier('an@demo'), isNull);
    expect(normalizeLoginIdentifier('a b@demo.vn'), isNull);
  });

  test('số điện thoại Việt Nam đổi sang +84', () {
    expect(normalizeLoginIdentifier('0901234567'), '+84901234567');
    expect(normalizeLoginIdentifier('090 123 4567'), '+84901234567');
    expect(normalizeLoginIdentifier('090.123.4567'), '+84901234567');
    expect(normalizeLoginIdentifier('+84 901 234 567'), '+84901234567');
    expect(normalizeLoginIdentifier('84901234567'), '+84901234567');
  });

  test('không phải email hay số điện thoại → null', () {
    expect(normalizeLoginIdentifier(''), isNull);
    expect(normalizeLoginIdentifier('090123'), isNull);
    expect(normalizeLoginIdentifier('09012345678'), isNull);
    expect(normalizeLoginIdentifier('nguyenvanan'), isNull);
  });
}
