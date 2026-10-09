/// Số liệu 30 ngày gần nhất trong phạm vi xem, từ `GET /reports/dashboard`.
class DashboardStats {
  const DashboardStats({
    required this.activeProperties,
    required this.newCustomers,
    required this.viewings,
    required this.wonDeals,
  });

  factory DashboardStats.fromJson(Map<String, dynamic> json) => DashboardStats(
    activeProperties:
        (json['properties'] as Map<String, dynamic>)['active'] as int,
    newCustomers: (json['customers'] as Map<String, dynamic>)['new'] as int,
    viewings: json['viewings'] as int,
    wonDeals: (json['deals'] as Map<String, dynamic>)['won'] as int,
  );

  /// BĐS đang bán (hiện tại).
  final int activeProperties;

  /// Khách mới trong kỳ.
  final int newCustomers;

  /// Lịch xem nhà trong kỳ (trừ lịch huỷ).
  final int viewings;

  /// Giao dịch thành công trong kỳ.
  final int wonDeals;
}

/// Lịch hẹn sắp tới, từ `GET /appointments`.
class UpcomingAppointment {
  const UpcomingAppointment({
    required this.id,
    required this.scheduledAt,
    required this.customerName,
    required this.propertyCode,
    required this.propertyTitle,
    this.location,
  });

  factory UpcomingAppointment.fromJson(Map<String, dynamic> json) {
    final customer = json['customer'] as Map<String, dynamic>;
    final property = json['property'] as Map<String, dynamic>;
    return UpcomingAppointment(
      id: json['id'] as String,
      scheduledAt: DateTime.parse(json['scheduledAt'] as String),
      customerName: customer['fullName'] as String,
      propertyCode: property['code'] as String,
      propertyTitle: property['title'] as String,
      location: json['location'] as String?,
    );
  }

  final String id;
  final DateTime scheduledAt;
  final String customerName;
  final String propertyCode;
  final String propertyTitle;
  final String? location;
}
