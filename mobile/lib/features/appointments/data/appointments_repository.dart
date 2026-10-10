import '../../../core/network/api_client.dart';
import '../../../core/network/page.dart';
import '../domain/appointment.dart';

/// Gọi API lịch hẹn (cần `appointment.view`; đổi trạng thái cần `appointment.manage`).
class AppointmentsRepository {
  AppointmentsRepository(this._api);

  final ApiClient _api;

  /// Backend cho tối đa 100 dòng mỗi trang.
  static const pageSize = 100;

  /// Dừng sau chừng này trang (10.000 lịch trong một khoảng là bất thường).
  static const maxPages = 100;

  /// Mọi lịch hẹn xem được có giờ hẹn trong [from, to), sớm trước (tải hết các trang).
  Future<List<Appointment>> range(DateTime from, DateTime to) async {
    final items = <Appointment>[];
    for (var page = 1; page <= maxPages; page++) {
      final result = Page.from(
        await _api.get(
          '/appointments',
          query: {
            'from': from.toUtc().toIso8601String(),
            'to': to.toUtc().toIso8601String(),
            'page': page,
            'pageSize': pageSize,
          },
        ),
        Appointment.fromJson,
      );
      items.addAll(result.items);
      if (!result.meta.hasNext) {
        break;
      }
    }
    return items;
  }

  /// Đổi trạng thái lịch: `COMPLETED` (kèm [outcome] nếu có), `NO_SHOW` (chỉ khi đã tới giờ hẹn), `CANCELLED`,
  /// `SCHEDULED`. Người khác đã lưu sau [expectedUpdatedAt] → `ApiException` `CONFLICT`.
  Future<Appointment> changeStatus(
    String id, {
    required String status,
    String? outcome,
    required DateTime expectedUpdatedAt,
  }) async => Appointment.fromJson(
    (await _api.post(
      '/appointments/$id/status',
      body: {
        'status': status,
        if (status == 'COMPLETED' && outcome != null) 'outcome': outcome,
        'expectedUpdatedAt': expectedUpdatedAt.toUtc().toIso8601String(),
      },
    )).object,
  );
}
