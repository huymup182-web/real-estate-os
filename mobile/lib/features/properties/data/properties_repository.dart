import '../../../core/network/api_client.dart';
import '../../../core/network/page.dart';
import '../domain/property_detail.dart';
import '../domain/property_draft.dart';
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

  /// Chi tiết BĐS. Không xem được (ngoài phạm vi, đã xoá) → `ApiException` mã `NOT_FOUND`.
  Future<PropertyDetail> detail(String id) async =>
      PropertyDetail.fromJson((await _api.get('/properties/$id')).object);

  /// Ảnh của BĐS theo thứ tự hiển thị.
  Future<List<PropertyImage>> images(String id) async =>
      (await _api.get('/properties/$id/images')).list
          .map(PropertyImage.fromJson)
          .toList();

  /// Tạo BĐS; người tạo là môi giới phụ trách. Trả id và mã BĐS vừa cấp. Sai dữ liệu → `ApiException`
  /// `VALIDATION_ERROR` kèm lỗi từng trường.
  Future<({String id, String code})> create(PropertyDraft draft) async {
    final data = (await _api.post(
      '/properties',
      body: draft.toCreateJson(),
    )).object;
    return (id: data['id'] as String, code: data['code'] as String);
  }
}
