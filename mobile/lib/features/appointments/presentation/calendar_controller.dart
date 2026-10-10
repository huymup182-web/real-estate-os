import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/clock.dart';
import '../../../core/error/api_exception.dart';
import '../../../core/format/vn_format.dart';
import '../../../core/providers.dart';
import '../../home/presentation/home_providers.dart';
import '../data/appointments_repository.dart';
import '../domain/appointment.dart';

final appointmentsRepositoryProvider = Provider<AppointmentsRepository>(
  (ref) => AppointmentsRepository(ref.watch(apiClientProvider)),
);

/// Ngày theo lịch Việt Nam, dạng `DateTime.utc(năm, tháng, ngày)` (chỉ đọc year/month/day).
typedef VnDay = DateTime;

VnDay vnToday(DateTime now) {
  final vn = toVn(now);
  return DateTime.utc(vn.year, vn.month, vn.day);
}

/// Tháng đang xem và ngày đang chọn trên lịch; mở màn hình thì là hôm nay (giờ Việt Nam).
class CalendarController extends Notifier<({VnDay month, VnDay day})> {
  @override
  ({VnDay month, VnDay day}) build() => _at(vnToday(ref.read(clockProvider)()));

  static ({VnDay month, VnDay day}) _at(VnDay day) =>
      (month: DateTime.utc(day.year, day.month), day: day);

  void select(VnDay day) => state = _at(day);

  void today() => state = _at(vnToday(ref.read(clockProvider)()));

  /// Sang tháng trước/sau ([delta] = -1/1), chọn ngày 1 (hoặc hôm nay nếu là tháng này).
  void moveMonth(int delta) {
    final month = DateTime.utc(state.month.year, state.month.month + delta);
    final today = vnToday(ref.read(clockProvider)());
    state = today.year == month.year && today.month == month.month
        ? _at(today)
        : _at(month);
  }
}

final calendarProvider =
    NotifierProvider.autoDispose<
      CalendarController,
      ({VnDay month, VnDay day})
    >(CalendarController.new);

/// Lịch hẹn của một tháng (giờ Việt Nam), nhóm theo ngày trong tháng, mỗi ngày sớm trước.
final monthAppointmentsProvider = FutureProvider.autoDispose
    .family<Map<int, List<Appointment>>, VnDay>((ref, month) async {
      final items = await ref
          .watch(appointmentsRepositoryProvider)
          .range(
            vnDayStart(month.year, month.month, 1),
            vnDayStart(month.year, month.month + 1, 1),
          );
      final byDay = <int, List<Appointment>>{};
      for (final item in items) {
        byDay.putIfAbsent(toVn(item.scheduledAt).day, () => []).add(item);
      }
      return byDay;
    }, retry: (_, _) => null);

/// Đổi trạng thái [appointment]. Xong (hoặc người khác vừa sửa, 409) thì tải lại lịch tháng và lịch sắp tới ở
/// trang chủ. Trả lỗi để màn hình báo. Dùng [container] của app vì bảng chọn có thể đã đóng khi API trả về.
Future<Object?> changeAppointmentStatus(
  ProviderContainer container,
  Appointment appointment, {
  required String status,
  String? outcome,
}) async {
  Object? failure;
  try {
    await container
        .read(appointmentsRepositoryProvider)
        .changeStatus(
          appointment.id,
          status: status,
          outcome: outcome,
          expectedUpdatedAt: appointment.updatedAt,
        );
  } on Object catch (error) {
    failure = error;
    if (error is! ApiException || error.code != ErrorCodes.conflict) {
      return error;
    }
  }
  container
    ..invalidate(monthAppointmentsProvider)
    ..invalidate(upcomingAppointmentsProvider);
  return failure;
}
