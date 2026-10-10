import '../../../core/network/api_client.dart';
import '../../../core/network/page.dart';
import '../domain/customer_detail.dart';
import '../domain/customer_query.dart';
import '../domain/customer_summary.dart';

/// Gọi API khách hàng.
class CustomersRepository {
  CustomersRepository(this._api);

  final ApiClient _api;

  static const pageSize = 20;

  /// Một trang khách trong phạm vi xem (`customer.view`) khớp [query], mới tạo trước.
  Future<Page<CustomerSummary>> list({
    required int page,
    CustomerQuery query = const CustomerQuery(),
  }) async => Page.from(
    await _api.get(
      '/customers',
      query: {'page': page, 'pageSize': pageSize, ...query.toQueryParameters()},
    ),
    CustomerSummary.fromJson,
  );

  /// Chi tiết khách. Không xem được (ngoài phạm vi, đã xoá) → `ApiException` mã `NOT_FOUND`.
  Future<CustomerDetail> detail(String id) async =>
      CustomerDetail.fromJson((await _api.get('/customers/$id')).object);

  /// Mọi nhu cầu của khách (kể cả đang tạm dừng), tạo trước đứng trước.
  Future<List<CustomerPreference>> preferences(String id) async =>
      (await _api.get('/customers/$id/preferences')).list
          .map(CustomerPreference.fromJson)
          .toList();

  /// Một trang timeline chăm sóc khách, xảy ra gần đây trước.
  Future<Page<CustomerActivity>> activities(
    String id, {
    required int page,
  }) async => Page.from(
    await _api.get(
      '/customers/$id/activities',
      query: {'page': page, 'pageSize': pageSize},
    ),
    CustomerActivity.fromJson,
  );

  /// Họ tên một người dùng (cần `user.view`), để hiện môi giới phụ trách.
  Future<String> userName(String userId) async =>
      (await _api.get('/users/$userId')).object['fullName'] as String;

  /// Số khách xem được ở từng bước pipeline, theo thứ tự pipeline (bước không có khách là 0).
  Future<List<({String status, int count})>> pipeline() async =>
      (await _api.get('/customers/pipeline')).list
          .map(
            (row) => (
              status: row['status'] as String,
              count: (row['count'] as num).toInt(),
            ),
          )
          .toList();

  /// Chuyển khách sang bước [status] (cần `customer.edit` với khách). Sang `LOST` bắt buộc [lostReason]. Người
  /// khác đã lưu sau [expectedUpdatedAt] → `ApiException` `CONFLICT`. Trả chi tiết sau khi chuyển.
  Future<CustomerDetail> changeStatus(
    String id, {
    required String status,
    String? lostReason,
    required DateTime expectedUpdatedAt,
  }) async => CustomerDetail.fromJson(
    (await _api.post(
      '/customers/$id/status',
      body: {
        'status': status,
        if (status == 'LOST') 'lostReason': lostReason,
        'expectedUpdatedAt': expectedUpdatedAt.toUtc().toIso8601String(),
      },
    )).object,
  );
}
