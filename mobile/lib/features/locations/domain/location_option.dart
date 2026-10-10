/// Một tỉnh/thành hoặc phường/xã (`GET /locations/provinces`, `GET /locations/provinces/:id/wards`).
class LocationOption {
  const LocationOption({
    required this.id,
    required this.code,
    required this.name,
  });

  factory LocationOption.fromJson(Map<String, dynamic> json) => LocationOption(
    id: json['id'] as String,
    code: json['code'] as String,
    name: json['name'] as String,
  );

  final String id;
  final String code;
  final String name;
}
