/// Chuẩn hoá ô "Email hoặc số điện thoại" trước khi gửi `POST /auth/login`: email giữ nguyên (bỏ khoảng trắng),
/// số điện thoại Việt Nam đổi sang dạng `+84…` như backend lưu (`0901 234 567` → `+84901234567`).
/// Không phải email, không phải số điện thoại → null.
String? normalizeLoginIdentifier(String input) {
  final value = input.trim();
  if (value.contains('@')) {
    return RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(value) ? value : null;
  }
  final digits = value.replaceAll(RegExp(r'[\s.\-()]'), '');
  final match = RegExp(r'^(?:\+84|84|0)(\d{9})$').firstMatch(digits);
  return match == null ? null : '+84${match.group(1)}';
}
