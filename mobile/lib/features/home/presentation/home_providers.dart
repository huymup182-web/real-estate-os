import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/clock.dart';
import '../../../core/providers.dart';
import '../../auth/presentation/session_controller.dart';
import '../data/home_repository.dart';
import '../domain/home_summary.dart';

final homeRepositoryProvider = Provider<HomeRepository>(
  (ref) => HomeRepository(ref.watch(apiClientProvider)),
);

/// Số liệu trang chủ; null khi người dùng không có `report.view` (ẩn phần số liệu). Lỗi thì hiện nút thử lại,
/// không tự thử lại.
final dashboardStatsProvider = FutureProvider.autoDispose<DashboardStats?>((
  ref,
) async {
  final user = ref.watch(sessionProvider).value?.user;
  if (user == null || !user.can('report.view')) {
    return null;
  }
  return ref.watch(homeRepositoryProvider).stats();
}, retry: (_, _) => null);

/// Lịch hẹn sắp tới; null khi không có `appointment.view`.
final upcomingAppointmentsProvider =
    FutureProvider.autoDispose<List<UpcomingAppointment>?>((ref) async {
      final user = ref.watch(sessionProvider).value?.user;
      if (user == null || !user.can('appointment.view')) {
        return null;
      }
      return ref
          .watch(homeRepositoryProvider)
          .upcomingAppointments(ref.read(clockProvider)());
    }, retry: (_, _) => null);
