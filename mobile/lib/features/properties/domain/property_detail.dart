/// Chủ nhà, chỉ có khi người xem được xem liên hệ chủ nhà của BĐS.
class PropertyOwner {
  const PropertyOwner({
    required this.fullName,
    required this.phone,
    this.email,
    this.notes,
  });

  factory PropertyOwner.fromJson(Map<String, dynamic> json) => PropertyOwner(
    fullName: json['fullName'] as String,
    phone: json['phone'] as String,
    email: json['email'] as String?,
    notes: json['notes'] as String?,
  );

  final String fullName;
  final String phone;
  final String? email;
  final String? notes;
}

/// Chi tiết BĐS (`GET /properties/:id`).
class PropertyDetail {
  const PropertyDetail({
    required this.id,
    required this.code,
    required this.title,
    required this.propertyType,
    required this.price,
    required this.area,
    required this.status,
    required this.verificationStatus,
    required this.provinceId,
    required this.wardId,
    required this.provinceName,
    required this.wardName,
    required this.updatedAt,
    this.description,
    this.pricePerM2,
    this.bedrooms,
    this.bathrooms,
    this.floors,
    this.direction,
    this.roadWidth,
    this.roadAccess,
    this.legalStatus,
    this.streetAddress,
    this.lastVerifiedAt,
    this.ownerContactVisible = false,
    this.owner,
    this.isFavorite = false,
    this.canEdit = false,
  });

  factory PropertyDetail.fromJson(Map<String, dynamic> json) {
    double? decimal(String key) => (json[key] as num?)?.toDouble();
    final owner = json['owner'] as Map<String, dynamic>?;
    final lastVerifiedAt = json['lastVerifiedAt'] as String?;
    return PropertyDetail(
      id: json['id'] as String,
      code: json['code'] as String,
      title: json['title'] as String,
      description: json['description'] as String?,
      propertyType: json['propertyType'] as String,
      price: (json['price'] as num).toInt(),
      area: (json['area'] as num).toDouble(),
      pricePerM2: (json['pricePerM2'] as num?)?.toInt(),
      bedrooms: json['bedrooms'] as int?,
      bathrooms: json['bathrooms'] as int?,
      floors: json['floors'] as int?,
      direction: json['direction'] as String?,
      roadWidth: decimal('roadWidth'),
      roadAccess: json['roadAccess'] as String?,
      legalStatus: json['legalStatus'] as String?,
      status: json['status'] as String,
      verificationStatus: json['verificationStatus'] as String,
      lastVerifiedAt: lastVerifiedAt == null
          ? null
          : DateTime.parse(lastVerifiedAt),
      provinceId: json['provinceId'] as String,
      wardId: json['wardId'] as String,
      provinceName: json['provinceName'] as String? ?? '',
      wardName: json['wardName'] as String? ?? '',
      streetAddress: json['streetAddress'] as String?,
      ownerContactVisible: json['ownerContactVisible'] as bool? ?? false,
      owner: owner == null ? null : PropertyOwner.fromJson(owner),
      isFavorite: json['isFavorite'] as bool? ?? false,
      canEdit: json['canEdit'] as bool? ?? false,
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }

  final String id;
  final String code;
  final String title;
  final String? description;
  final String propertyType;

  /// Giá bán, đồng.
  final int price;

  /// Diện tích, m².
  final double area;

  /// Đồng/m² (database tự tính).
  final int? pricePerM2;
  final int? bedrooms;
  final int? bathrooms;
  final int? floors;
  final String? direction;

  /// Mét.
  final double? roadWidth;
  final String? roadAccess;
  final String? legalStatus;
  final String status;
  final String verificationStatus;
  final DateTime? lastVerifiedAt;
  final String provinceId;
  final String wardId;
  final String provinceName;
  final String wardName;

  /// Số nhà, đường; null khi không được xem liên hệ chủ nhà.
  final String? streetAddress;
  final bool ownerContactVisible;
  final PropertyOwner? owner;
  final bool isFavorite;

  /// BĐS trong phạm vi `property.edit` của người xem.
  final bool canEdit;

  /// Gửi lại khi sửa (`expectedUpdatedAt`) để không ghi đè bản người khác vừa lưu.
  final DateTime updatedAt;

  /// "12 Đường 2/4, Vĩnh Hải, Khánh Hòa" (thiếu phần nào thì bỏ phần đó).
  String get address => [
    streetAddress,
    wardName,
    provinceName,
  ].whereType<String>().where((part) => part.isNotEmpty).join(', ');
}

/// Ảnh BĐS (`GET /properties/:id/images`), theo thứ tự hiển thị.
class PropertyImage {
  const PropertyImage({
    required this.id,
    required this.url,
    this.thumbnailUrl,
    this.isCover = false,
  });

  factory PropertyImage.fromJson(Map<String, dynamic> json) => PropertyImage(
    id: json['id'] as String,
    url: json['url'] as String,
    thumbnailUrl: json['thumbnailUrl'] as String?,
    isCover: json['isCover'] as bool? ?? false,
  );

  final String id;
  final String url;
  final String? thumbnailUrl;
  final bool isCover;
}
