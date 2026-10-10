import 'package:flutter/foundation.dart' show immutable, setEquals;

import 'property_labels.dart';

/// Điều kiện tìm BĐS gửi lên `GET /properties`: từ khoá (TASK-119), bộ lọc và sắp xếp (TASK-120), đường vào
/// (TASK-134).
@immutable
class PropertyQuery {
  const PropertyQuery({
    this.keyword = '',
    this.sort,
    this.propertyTypes = const {},
    this.priceMin,
    this.priceMax,
    this.areaMin,
    this.areaMax,
    this.provinceId,
    this.wardId,
    this.bedroomsMin,
    this.legalStatuses = const {},
    this.directions = const {},
    this.roadAccesses = const {},
  });

  /// Bộ lọc dạng tham số của `GET /properties` (vd `filters` của tìm bằng AI, TASK-134). Bỏ qua trường lạ
  /// hoặc sai kiểu.
  factory PropertyQuery.fromFilters(Map<String, dynamic> filters) {
    int? integer(String key) => switch (filters[key]) {
      final int value => value,
      final double value when value == value.roundToDouble() => value.toInt(),
      _ => null,
    };
    double? decimal(String key) => switch (filters[key]) {
      final num value => value.toDouble(),
      _ => null,
    };
    String? text(String key) => switch (filters[key]) {
      final String value when value.isNotEmpty => value,
      _ => null,
    };
    Set<String> values(String key, Map<String, String> allowed) =>
        switch (filters[key]) {
          final List<dynamic> list =>
            list.whereType<String>().where(allowed.containsKey).toSet(),
          _ => const {},
        };
    final provinceId = text('provinceId');
    final sort = text('sort');
    return PropertyQuery(
      keyword: normalizeKeyword(text('q') ?? ''),
      sort: propertySortLabels.containsKey(sort) ? sort : null,
      propertyTypes: values('propertyType', propertyTypeLabels),
      priceMin: integer('priceMin'),
      priceMax: integer('priceMax'),
      areaMin: decimal('areaMin'),
      areaMax: decimal('areaMax'),
      provinceId: provinceId,
      wardId: provinceId == null ? null : text('wardId'),
      bedroomsMin: integer('bedroomsMin'),
      legalStatuses: values('legalStatus', legalStatusLabels),
      directions: values('direction', directionLabels),
      roadAccesses: values('roadAccess', roadAccessLabels),
    );
  }

  /// Từ khoá (mã BĐS hoặc chữ trong tiêu đề, mô tả, địa chỉ), đã chuẩn hoá bằng [normalizeKeyword].
  final String keyword;

  /// Một khoá của `propertySortLabels`; `null` là mặc định của API (có từ khoá: phù hợp nhất, không: mới nhất).
  final String? sort;
  final Set<String> propertyTypes;

  /// Giá (đồng), gồm cả hai đầu.
  final int? priceMin;
  final int? priceMax;

  /// Diện tích (m²), gồm cả hai đầu.
  final double? areaMin;
  final double? areaMax;
  final String? provinceId;

  /// Chỉ có khi đã chọn [provinceId].
  final String? wardId;
  final int? bedroomsMin;
  final Set<String> legalStatuses;
  final Set<String> directions;

  /// Đường vào (TASK-134), khớp một trong các loại đã chọn.
  final Set<String> roadAccesses;

  static const maxKeywordLength = 200;

  /// Số nhóm lọc/sắp xếp đang khác mặc định (hiện trên nút "Bộ lọc").
  int get filterCount => [
    sort != null,
    propertyTypes.isNotEmpty,
    priceMin != null || priceMax != null,
    areaMin != null || areaMax != null,
    provinceId != null,
    bedroomsMin != null,
    legalStatuses.isNotEmpty,
    directions.isNotEmpty,
    roadAccesses.isNotEmpty,
  ].where((active) => active).length;

  bool get hasFilters => filterCount > 0;

  bool get isEmpty => keyword.isEmpty && !hasFilters;

  PropertyQuery withKeyword(String text) =>
      withFilters(this, keyword: normalizeKeyword(text));

  /// Bộ lọc, sắp xếp của [filters], giữ từ khoá hiện tại (hoặc [keyword] nếu có).
  PropertyQuery withFilters(PropertyQuery filters, {String? keyword}) =>
      PropertyQuery(
        keyword: keyword ?? this.keyword,
        sort: filters.sort,
        propertyTypes: filters.propertyTypes,
        priceMin: filters.priceMin,
        priceMax: filters.priceMax,
        areaMin: filters.areaMin,
        areaMax: filters.areaMax,
        provinceId: filters.provinceId,
        wardId: filters.provinceId == null ? null : filters.wardId,
        bedroomsMin: filters.bedroomsMin,
        legalStatuses: filters.legalStatuses,
        directions: filters.directions,
        roadAccesses: filters.roadAccesses,
      );

  PropertyQuery withoutFilters() => PropertyQuery(keyword: keyword);

  /// Tham số query của API; danh sách gửi dạng `HOUSE,APARTMENT`.
  Map<String, Object> toQueryParameters() => {
    if (keyword.isNotEmpty) 'q': keyword,
    if (propertyTypes.isNotEmpty) 'propertyType': _csv(propertyTypes),
    'priceMin': ?priceMin,
    'priceMax': ?priceMax,
    if (areaMin != null) 'areaMin': _decimal(areaMin!),
    if (areaMax != null) 'areaMax': _decimal(areaMax!),
    'provinceId': ?provinceId,
    'wardId': ?wardId,
    'bedroomsMin': ?bedroomsMin,
    if (legalStatuses.isNotEmpty) 'legalStatus': _csv(legalStatuses),
    if (directions.isNotEmpty) 'direction': _csv(directions),
    if (roadAccesses.isNotEmpty) 'roadAccess': _csv(roadAccesses),
    'sort': ?sort,
  };

  static String _csv(Set<String> values) => (values.toList()..sort()).join(',');

  static String _decimal(double value) => value == value.roundToDouble()
      ? value.round().toString()
      : value.toString();

  @override
  String toString() => 'PropertyQuery(${toQueryParameters()})';

  @override
  bool operator ==(Object other) =>
      other is PropertyQuery &&
      other.keyword == keyword &&
      other.sort == sort &&
      setEquals(other.propertyTypes, propertyTypes) &&
      other.priceMin == priceMin &&
      other.priceMax == priceMax &&
      other.areaMin == areaMin &&
      other.areaMax == areaMax &&
      other.provinceId == provinceId &&
      other.wardId == wardId &&
      other.bedroomsMin == bedroomsMin &&
      setEquals(other.legalStatuses, legalStatuses) &&
      setEquals(other.directions, directions) &&
      setEquals(other.roadAccesses, roadAccesses);

  @override
  int get hashCode => Object.hash(
    keyword,
    sort,
    Object.hashAllUnordered(propertyTypes),
    priceMin,
    priceMax,
    areaMin,
    areaMax,
    provinceId,
    wardId,
    bedroomsMin,
    Object.hashAllUnordered(legalStatuses),
    Object.hashAllUnordered(directions),
    Object.hashAllUnordered(roadAccesses),
  );
}

/// Bỏ khoảng trắng thừa, cắt còn [PropertyQuery.maxKeywordLength] ký tự (giới hạn của API).
String normalizeKeyword(String text) {
  final collapsed = text.trim().replaceAll(RegExp(r'\s+'), ' ');
  return collapsed.length <= PropertyQuery.maxKeywordLength
      ? collapsed
      : collapsed.substring(0, PropertyQuery.maxKeywordLength).trimRight();
}

/// Đọc số người dùng gõ, chấp nhận dấu phẩy hay dấu chấm thập phân ("3,5" = "3.5"), tối đa [decimals] chữ số
/// sau dấu. Trống → `null`; sai dạng → [FormatException].
double? parseDecimalInput(String text, {int decimals = 2}) {
  final value = text.trim().replaceAll(',', '.');
  if (value.isEmpty) {
    return null;
  }
  if (!RegExp('^\\d{1,10}(\\.\\d{1,$decimals})?\$').hasMatch(value)) {
    throw FormatException('Số không hợp lệ', text);
  }
  return double.parse(value);
}
