/// Định dạng ngày giờ, số theo kiểu Việt Nam. Backend trả thời điểm UTC; app hiện theo giờ Việt Nam (UTC+7, không
/// đổi giờ theo mùa) dù điện thoại đặt múi giờ nào, giống web admin.
const _vnOffset = Duration(hours: 7);

/// Thời điểm [at] đổi sang "đồng hồ" Việt Nam (đọc year/month/day/hour... là giờ Việt Nam).
DateTime toVn(DateTime at) => at.toUtc().add(_vnOffset);

/// Thời điểm 0 giờ (giờ Việt Nam) của ngày [year]/[month]/[day], dạng UTC. Tháng/ngày tràn thì tự sang tháng sau
/// (như `DateTime.utc`).
DateTime vnDayStart(int year, int month, int day) =>
    DateTime.utc(year, month, day).subtract(_vnOffset);

String _two(int value) => value.toString().padLeft(2, '0');

/// `08:30`.
String vnTime(DateTime at) {
  final vn = toVn(at);
  return '${_two(vn.hour)}:${_two(vn.minute)}';
}

/// `09/10/2026`.
String vnDate(DateTime at) {
  final vn = toVn(at);
  return '${_two(vn.day)}/${_two(vn.month)}/${vn.year}';
}

const _weekdays = [
  'Thứ 2',
  'Thứ 3',
  'Thứ 4',
  'Thứ 5',
  'Thứ 6',
  'Thứ 7',
  'Chủ nhật',
];

/// `Thứ 6, 16/10/2026` (theo giờ Việt Nam).
String vnWeekdayDate(DateTime at) =>
    '${_weekdays[toVn(at).weekday - 1]}, ${vnDate(at)}';

/// Ngày của [at] so với [now] theo giờ Việt Nam: `Hôm nay`, `Ngày mai`, `Hôm qua`, còn lại `Thứ 6, 16/10`
/// (khác năm thì thêm năm).
String vnDayLabel(DateTime at, DateTime now) {
  final day = toVn(at);
  final today = toVn(now);
  final diff = DateTime.utc(
    day.year,
    day.month,
    day.day,
  ).difference(DateTime.utc(today.year, today.month, today.day)).inDays;
  switch (diff) {
    case 0:
      return 'Hôm nay';
    case 1:
      return 'Ngày mai';
    case -1:
      return 'Hôm qua';
  }
  final label =
      '${_weekdays[day.weekday - 1]}, ${_two(day.day)}/${_two(day.month)}';
  return day.year == today.year ? label : '$label/${day.year}';
}

/// Số nguyên có dấu chấm phân cách nghìn: `1.234.567`.
String vnNumber(int value) {
  final digits = value.abs().toString();
  final buffer = StringBuffer(value < 0 ? '-' : '');
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) {
      buffer.write('.');
    }
    buffer.write(digits[i]);
  }
  return buffer.toString();
}

/// Số thập phân kiểu Việt, tối đa 2 chữ số sau dấu phẩy: 70 → "70", 1250 → "1.250", 70.5 → "70,5".
String vnDecimal(double value) {
  final text = value.toStringAsFixed(2);
  final [whole, fraction] = text.split('.');
  final decimals = fraction.replaceFirst(RegExp(r'0+$'), '');
  final integer = vnNumber(int.parse(whole));
  return decimals.isEmpty ? integer : '$integer,$decimals';
}

/// Số tiền đồng viết gọn: `3,5 tỷ`, `850 triệu`, `12.000 đ`.
String vnMoneyShort(int value) {
  String trim(double number) {
    final text = number.toStringAsFixed(number >= 100 ? 0 : 1);
    return text.endsWith('.0') ? text.substring(0, text.length - 2) : text;
  }

  if (value.abs() >= 1000000000) {
    return '${trim(value / 1000000000).replaceAll('.', ',')} tỷ';
  }
  if (value.abs() >= 1000000) {
    return '${trim(value / 1000000).replaceAll('.', ',')} triệu';
  }
  return '${vnNumber(value)} đ';
}

/// Số điện thoại Việt Nam dạng quốc tế (`+84901234567`) hiện theo kiểu trong nước: `0901 234 567`. Số nước khác
/// hoặc không đúng dạng thì giữ nguyên.
String vnPhone(String phone) {
  final match = RegExp(r'^\+84(\d{9})$').firstMatch(phone);
  if (match == null) {
    return phone;
  }
  final digits = '0${match[1]}';
  return '${digits.substring(0, 4)} ${digits.substring(4, 7)} ${digits.substring(7)}';
}
