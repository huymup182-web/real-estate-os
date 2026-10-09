import 'package:flutter/services.dart';

import 'vn_format.dart';

/// Ô nhập số nguyên có dấu chấm ngăn hàng nghìn khi gõ: "3500000000" → "3.500.000.000". Chỉ giữ chữ số, tối
/// đa [maxDigits] chữ số.
class ThousandsInputFormatter extends TextInputFormatter {
  const ThousandsInputFormatter({this.maxDigits = 15});

  final int maxDigits;

  /// Số trong ô (bỏ dấu chấm); trống → null.
  static int? parse(String text) {
    final digits = text.replaceAll(RegExp(r'\D'), '');
    return digits.isEmpty ? null : int.parse(digits);
  }

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    var digits = newValue.text.replaceAll(RegExp(r'\D'), '');
    if (digits.length > maxDigits) {
      return oldValue;
    }
    digits = digits.replaceFirst(RegExp(r'^0+(?=\d)'), '');
    if (digits.isEmpty) {
      return const TextEditingValue();
    }
    // Giữ con trỏ sau đúng số chữ số đứng trước nó.
    final cursor = newValue.selection.end.clamp(0, newValue.text.length);
    final digitsBefore = newValue.text
        .substring(0, cursor)
        .replaceAll(RegExp(r'\D'), '')
        .length
        .clamp(0, digits.length);
    final text = vnNumber(int.parse(digits));
    var offset = 0;
    var seen = 0;
    while (offset < text.length && seen < digitsBefore) {
      if (text[offset] != '.') {
        seen++;
      }
      offset++;
    }
    return TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: offset),
    );
  }
}
