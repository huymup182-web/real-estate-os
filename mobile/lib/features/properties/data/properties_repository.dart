import '../../../core/network/api_client.dart';
import '../../../core/network/page.dart';
import '../domain/property_query.dart';
import '../domain/property_summary.dart';

/// Gọi API BĐS.
class PropertiesRepository {
  PropertiesRepository(this._api);

  final ApiClient _api;

  static const pageSize = 20;

  /// Một trang BĐS trong phạm vi xem khớp [query]. Không có từ khoá thì mới tạo trước, có thì khớp nhiều hơn trước.
  Future<Page<PropertySummary>> list({
    required int page,
    PropertyQuery query = const PropertyQuery(),
  }) async => Page.from(
    await _api.get(
      '/properties',
      query: {'page': page, 'pageSize': pageSize, ...query.toQueryParameters()},
    ),
    PropertySummary.fromJson,
  );
}
