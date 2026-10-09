import '../../../core/format/vn_format.dart';
import '../../properties/domain/property_labels.dart';
import 'customer_detail.dart';
import 'customer_labels.dart';

/// Một dòng tóm tắt nhu cầu, như web admin: "Mua · Căn hộ, Đất nền · 2 tỷ – 3,5 tỷ · từ 60 m² · từ 2 PN ·
/// Khánh Hòa". [provinceNames] tra tên tỉnh; tỉnh không có trong bảng thì bỏ qua.
String preferenceSummary(
  CustomerPreference preference,
  Map<String, String> provinceNames,
) {
  final parts = [
    labelOf(transactionTypeLabels, preference.transactionType),
    preference.propertyTypes
        .map((type) => labelOf(propertyTypeLabels, type))
        .join(', '),
    _range(preference.budgetMin, preference.budgetMax, vnMoneyShort),
    _range(
      preference.areaMin,
      preference.areaMax,
      (value) => '${vnDecimal(value)} m²',
    ),
    if (preference.bedroomsMin case final bedrooms?) 'từ $bedrooms PN',
    preference.provinceIds.map((id) => provinceNames[id]).nonNulls.join(', '),
  ];
  return parts.where((part) => part.isNotEmpty).join(' · ');
}

String _range<T>(T? min, T? max, String Function(T value) format) =>
    switch ((min, max)) {
      (final min?, final max?) => '${format(min)} – ${format(max)}',
      (final min?, null) => 'từ ${format(min)}',
      (null, final max?) => 'đến ${format(max)}',
      _ => '',
    };
