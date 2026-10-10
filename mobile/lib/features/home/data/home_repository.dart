import '../../../core/network/api_client.dart';
import '../domain/home_summary.dart';

/// Dữ liệu trang chủ.
class HomeRepository {
  HomeRepository(this._api);

  final ApiClient _api;

  /// Số liệu 30 ngày gần nhất (mặc định của backend). Cần `report.view`.
  Future<DashboardStats> stats() async =>
      DashboardStats.fromJson((await _api.get('/reports/dashboard')).object);

  /// [limit] lịch đã đặt (`SCHEDULED`) từ [now] trở đi, sớm nhất trước. Cần `appointment.view`.
  Future<List<UpcomingAppointment>> upcomingAppointments(
    DateTime now, {
    int limit = 5,
  }) async {
    final response = await _api.get(
      '/appointments',
      query: {
        'from': now.toUtc().toIso8601String(),
        'status': 'SCHEDULED',
        'pageSize': limit,
      },
    );
    return response.list.map(UpcomingAppointment.fromJson).toList();
  }
}
