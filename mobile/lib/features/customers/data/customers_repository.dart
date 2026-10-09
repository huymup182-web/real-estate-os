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
}
