/// Nhãn loại thông báo (khớp backend `notification-values.ts`, web admin `lib/notifications.ts`).
const notificationTypeLabels = {
  'NEW_PROPERTY': 'BĐS mới khớp tìm kiếm',
  'PROPERTY_UPDATED': 'BĐS cập nhật',
  'MATCHED_PROPERTY': 'BĐS hợp khách',
  'CUSTOMER_ASSIGNED': 'Được giao khách',
  'NEW_LEAD': 'Khách mới',
  'VIEWING_REMINDER': 'Nhắc lịch hẹn',
  'VERIFY_REQUIRED': 'Cần xác minh BĐS',
  'SYSTEM_NOTIFICATION': 'Hệ thống',
};

/// Một thông báo trong hộp thư của người đang đăng nhập (`GET /notifications`).
class AppNotification {
  const AppNotification({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    required this.data,
    required this.createdAt,
    this.readAt,
  });

  factory AppNotification.fromJson(Map<String, dynamic> json) =>
      AppNotification(
        id: json['id'] as String,
        type: json['type'] as String,
        title: json['title'] as String,
        body: json['body'] as String,
        data: (json['data'] as Map<String, dynamic>?) ?? const {},
        readAt: switch (json['readAt']) {
          final String at => DateTime.parse(at),
          _ => null,
        },
        createdAt: DateTime.parse(json['createdAt'] as String),
      );

  final String id;

  /// `notificationTypeLabels`.
  final String type;
  final String title;
  final String body;
  final Map<String, dynamic> data;
  final DateTime? readAt;
  final DateTime createdAt;

  bool get unread => readAt == null;

  AppNotification markedRead(DateTime at) => AppNotification(
    id: id,
    type: type,
    title: title,
    body: body,
    data: data,
    createdAt: createdAt,
    readAt: readAt ?? at,
  );
}
