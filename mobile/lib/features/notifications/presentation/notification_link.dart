import '../../../core/router/app_router.dart';
import '../domain/app_notification.dart';

final _uuid = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  caseSensitive: false,
);

/// Màn hình liên quan (như web admin): lịch hẹn → lịch, BĐS → chi tiết BĐS, khách → chi tiết khách; nhắc xác
/// minh nhiều BĐS → danh sách BĐS. Không có thì null. Chỉ nhận id dạng UUID.
String? notificationLink(AppNotification notification) {
  final data = notification.data;
  String? id(String key) => switch (data[key]) {
    final String value when _uuid.hasMatch(value) => value,
    _ => null,
  };
  if (id('appointmentId') != null) {
    return AppRoutes.calendar;
  }
  if (id('propertyId') case final propertyId?) {
    return AppRoutes.propertyDetail(propertyId);
  }
  if (id('customerId') case final customerId?) {
    return AppRoutes.customerDetail(customerId);
  }
  if (notification.type == 'VERIFY_REQUIRED' && data['propertyIds'] is List) {
    final ids = [
      for (final value in data['propertyIds'] as List)
        if (value is String && _uuid.hasMatch(value)) value,
    ];
    return switch (ids) {
      [final only] => AppRoutes.propertyDetail(only),
      [] => null,
      _ => AppRoutes.properties,
    };
  }
  return null;
}
