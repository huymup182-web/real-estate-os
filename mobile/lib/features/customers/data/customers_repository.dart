import '../../../core/network/api_client.dart';
import '../../../core/network/page.dart';
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
}
