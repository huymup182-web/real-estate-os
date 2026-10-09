/// Một khách trong danh sách (`GET /customers`), chỉ các trường thẻ khách cần.
class CustomerSummary {
  const CustomerSummary({
    required this.id,
    required this.fullName,
    required this.phone,
    required this.status,
    required this.createdAt,
    this.email,
    this.purpose,
    this.purchaseTimeline,
    this.source,
  });

  factory CustomerSummary.fromJson(Map<String, dynamic> json) =>
      CustomerSummary(
        id: json['id'] as String,
        fullName: json['fullName'] as String,
        phone: json['phone'] as String,
        status: json['status'] as String,
        createdAt: DateTime.parse(json['createdAt'] as String),
        email: json['email'] as String?,
        purpose: json['purpose'] as String?,
        purchaseTimeline: json['purchaseTimeline'] as String?,
        source: json['source'] as String?,
      );

  final String id;
  final String fullName;

  /// Dạng quốc tế, vd `+84901234567`.
  final String phone;

  /// Bước pipeline (`customerStatusLabels`).
  final String status;
  final DateTime createdAt;
  final String? email;
  final String? purpose;
  final String? purchaseTimeline;
  final String? source;
}
