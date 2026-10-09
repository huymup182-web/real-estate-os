import '../../../core/network/api_client.dart';
import '../domain/location_option.dart';

/// Danh mục địa giới hành chính (sau sáp nhập 07/2025: tỉnh/thành → phường/xã). Ai đăng nhập cũng xem được.
class LocationsRepository {
  LocationsRepository(this._api);

  final ApiClient _api;

  Future<List<LocationOption>> provinces() async =>
      (await _api.get('/locations/provinces')).list
          .map(LocationOption.fromJson)
          .toList();

  Future<List<LocationOption>> wards(String provinceId) async =>
      (await _api.get('/locations/provinces/$provinceId/wards')).list
          .map(LocationOption.fromJson)
          .toList();
}
