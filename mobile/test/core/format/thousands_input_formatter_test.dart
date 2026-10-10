import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/format/thousands_input_formatter.dart';

TextEditingValue _typed(String text, [int? cursor]) => TextEditingValue(
  text: text,
  selection: TextSelection.collapsed(offset: cursor ?? text.length),
);

void main() {
  const formatter = ThousandsInputFormatter();

  test('chèn dấu chấm hàng nghìn, bỏ ký tự không phải số và số 0 đầu', () {
    expect(
      formatter.formatEditUpdate(_typed(''), _typed('3500000000')).text,
      '3.500.000.000',
    );
    expect(
      formatter.formatEditUpdate(_typed(''), _typed('00 12a3')).text,
      '123',
    );
    expect(formatter.formatEditUpdate(_typed('5'), _typed('')).text, '');
  });

  test('giữ con trỏ sau đúng chữ số khi sửa giữa chừng', () {
    // "1.000" sửa thành "12.000" khi gõ "2" sau số 1.
    final next = formatter.formatEditUpdate(
      _typed('1.000'),
      _typed('12.000', 2),
    );
    expect(next.text, '12.000');
    expect(next.selection.baseOffset, 2);
  });

  test('vượt số chữ số tối đa thì giữ giá trị cũ', () {
    const short = ThousandsInputFormatter(maxDigits: 3);
    final old = _typed('999');
    expect(short.formatEditUpdate(old, _typed('9999')), old);
  });

  test('parse bỏ dấu chấm', () {
    expect(ThousandsInputFormatter.parse('3.500.000.000'), 3500000000);
    expect(ThousandsInputFormatter.parse(''), isNull);
  });
}
