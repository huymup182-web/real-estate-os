import '../../../core/network/api_client.dart';
import '../../../core/network/page.dart';
import '../domain/property_summary.dart';

/// Gọi API BĐS.
class PropertiesRepository {
  PropertiesRepository(this._api);

  final ApiClient _api;

  static const pageSize = 20;

  /// Một trang BĐS trong phạm vi xem, mới tạo trước. Tìm kiếm, lọc thêm ở TASK-119, TASK-120.
  Future<Page<PropertySummary>> list({required int page}) async => Page.from(
    await _api.get('/properties', query: {'page': page, 'pageSize': pageSize}),
    PropertySummary.fromJson,
  );
}
