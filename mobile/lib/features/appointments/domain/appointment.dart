/// Nhãn trạng thái lịch hẹn (khớp backend `appointment-values.ts`, web admin `lib/appointments.ts`).
const appointmentStatusLabels = {
  'SCHEDULED': 'Đã hẹn',
  'COMPLETED': 'Đã xem',
  'CANCELLED': 'Đã huỷ',
  'NO_SHOW': 'Khách không đến',
};

/// Kết quả buổi xem, chỉ có khi lịch đã xem (`COMPLETED`).
const appointmentOutcomeLabels = {
  'INTERESTED': 'Quan tâm',
  'NOT_INTERESTED': 'Không quan tâm',
  'NEED_FOLLOW_UP': 'Cần chăm sóc thêm',
  'NEGOTIATING': 'Đang thương lượng',
};

/// Một lịch hẹn dẫn khách xem BĐS (`GET /appointments`).
class Appointment {
  const Appointment({
    required this.id,
    required this.customerId,
    required this.customerName,
    required this.propertyId,
    required this.propertyCode,
    required this.propertyTitle,
    required this.scheduledAt,
    required this.status,
    required this.updatedAt,
    this.durationMinutes,
    this.location,
    this.notes,
    this.outcome,
  });

  factory Appointment.fromJson(Map<String, dynamic> json) {
    final customer = json['customer'] as Map<String, dynamic>;
    final property = json['property'] as Map<String, dynamic>;
    return Appointment(
      id: json['id'] as String,
      customerId: customer['id'] as String,
      customerName: customer['fullName'] as String,
      propertyId: property['id'] as String,
      propertyCode: property['code'] as String,
      propertyTitle: property['title'] as String,
      scheduledAt: DateTime.parse(json['scheduledAt'] as String),
      status: json['status'] as String,
      updatedAt: DateTime.parse(json['updatedAt'] as String),
      durationMinutes: (json['durationMinutes'] as num?)?.toInt(),
      location: json['location'] as String?,
      notes: json['notes'] as String?,
      outcome: json['outcome'] as String?,
    );
  }

  final String id;
  final String customerId;
  final String customerName;
  final String propertyId;
  final String propertyCode;
  final String propertyTitle;
  final DateTime scheduledAt;

  /// `appointmentStatusLabels`.
  final String status;

  /// Gửi kèm khi đổi trạng thái để không ghi đè thay đổi của người khác.
  final DateTime updatedAt;
  final int? durationMinutes;
  final String? location;
  final String? notes;

  /// `appointmentOutcomeLabels`.
  final String? outcome;

  DateTime? get endsAt => durationMinutes == null
      ? null
      : scheduledAt.add(Duration(minutes: durationMinutes!));
}
