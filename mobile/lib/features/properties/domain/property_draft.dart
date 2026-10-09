import 'property_detail.dart';

/// BĐS người dùng nhập trên form tạo/sửa. Giá trị đã kiểm trên form; backend vẫn kiểm lại.
class PropertyDraft {
  const PropertyDraft({
    required this.title,
    required this.propertyType,
    required this.price,
    required this.area,
    required this.provinceId,
    required this.wardId,
    this.description,
    this.bedrooms,
    this.bathrooms,
    this.floors,
    this.direction,
    this.roadWidth,
    this.roadAccess,
    this.legalStatus,
    this.streetAddress,
  });

  /// Giá trị hiện tại của BĐS để điền sẵn form sửa.
  factory PropertyDraft.fromDetail(PropertyDetail detail) => PropertyDraft(
    title: detail.title,
    description: detail.description,
    propertyType: detail.propertyType,
    price: detail.price,
    area: detail.area,
    bedrooms: detail.bedrooms,
    bathrooms: detail.bathrooms,
    floors: detail.floors,
    direction: detail.direction,
    roadWidth: detail.roadWidth,
    roadAccess: detail.roadAccess,
    legalStatus: detail.legalStatus,
    provinceId: detail.provinceId,
    wardId: detail.wardId,
    streetAddress: detail.streetAddress,
  );

  final String title;
  final String? description;
  final String propertyType;

  /// Đồng.
  final int price;

  /// m².
  final double area;
  final int? bedrooms;
  final int? bathrooms;
  final int? floors;
  final String? direction;

  /// Mét.
  final double? roadWidth;
  final String? roadAccess;
  final String? legalStatus;
  final String provinceId;
  final String wardId;
  final String? streetAddress;

  /// Body `POST /properties`: bỏ trường trống (backend tự để null).
  Map<String, Object> toCreateJson() => {
    'title': title,
    'description': ?description,
    'propertyType': propertyType,
    'price': price,
    'area': area,
    'bedrooms': ?bedrooms,
    'bathrooms': ?bathrooms,
    'floors': ?floors,
    'direction': ?direction,
    'roadWidth': ?roadWidth,
    'roadAccess': ?roadAccess,
    'legalStatus': ?legalStatus,
    'provinceId': provinceId,
    'wardId': wardId,
    'streetAddress': ?streetAddress,
  };

  /// Body `PATCH /properties/:id`: gửi mọi trường, ô trống là `null` (xoá giá trị). Địa chỉ chi tiết chỉ gửi khi
  /// người sửa xem được nó ([withStreetAddress]), để không vô tình xoá địa chỉ mình không thấy.
  Map<String, Object?> toUpdateJson({
    required DateTime expectedUpdatedAt,
    required bool withStreetAddress,
  }) => {
    'title': title,
    'description': description,
    'propertyType': propertyType,
    'price': price,
    'area': area,
    'bedrooms': bedrooms,
    'bathrooms': bathrooms,
    'floors': floors,
    'direction': direction,
    'roadWidth': roadWidth,
    'roadAccess': roadAccess,
    'legalStatus': legalStatus,
    'provinceId': provinceId,
    'wardId': wardId,
    if (withStreetAddress) 'streetAddress': streetAddress,
    'expectedUpdatedAt': expectedUpdatedAt.toUtc().toIso8601String(),
  };
}
