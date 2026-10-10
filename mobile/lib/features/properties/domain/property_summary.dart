/// Một BĐS trong danh sách (`GET /properties`, `GET /properties/favorites`), chỉ các trường thẻ BĐS cần.
class PropertySummary {
  const PropertySummary({
    required this.id,
    required this.code,
    required this.title,
    required this.propertyType,
    required this.price,
    required this.area,
    required this.status,
    required this.provinceName,
    required this.wardName,
    this.bedrooms,
    this.bathrooms,
    this.coverUrl,
    this.isFavorite = false,
  });

  factory PropertySummary.fromJson(Map<String, dynamic> json) {
    final cover = json['coverImage'] as Map<String, dynamic>?;
    return PropertySummary(
      id: json['id'] as String,
      code: json['code'] as String,
      title: json['title'] as String,
      propertyType: json['propertyType'] as String,
      price: (json['price'] as num).toInt(),
      area: (json['area'] as num).toDouble(),
      status: json['status'] as String,
      provinceName: json['provinceName'] as String? ?? '',
      wardName: json['wardName'] as String? ?? '',
      bedrooms: json['bedrooms'] as int?,
      bathrooms: json['bathrooms'] as int?,
      coverUrl: cover == null
          ? null
          : (cover['thumbnailUrl'] ?? cover['url']) as String?,
      isFavorite: json['isFavorite'] as bool? ?? false,
    );
  }

  final String id;
  final String code;
  final String title;
  final String propertyType;

  /// Giá bán, đồng.
  final int price;

  /// Diện tích, m².
  final double area;
  final String status;
  final String provinceName;
  final String wardName;
  final int? bedrooms;
  final int? bathrooms;

  /// Ảnh nhỏ của ảnh bìa (không có thì ảnh gốc); null khi BĐS chưa có ảnh.
  final String? coverUrl;
  final bool isFavorite;

  /// "Vĩnh Hải, Khánh Hòa".
  String get location =>
      [wardName, provinceName].where((part) => part.isNotEmpty).join(', ');
}
