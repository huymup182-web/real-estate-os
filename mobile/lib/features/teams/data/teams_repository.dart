import '../../../core/network/api_client.dart';
import '../domain/team.dart';

/// Gọi API nhóm (cần `team.view`; chỉ thấy nhóm trong phạm vi quyền, môi giới thường chỉ thấy nhóm của mình).
class TeamsRepository {
  TeamsRepository(this._api);

  final ApiClient _api;

  /// Theo phòng ban rồi tên nhóm.
  Future<List<TeamSummary>> list() async => [
    for (final json in (await _api.get('/teams')).list)
      TeamSummary.fromJson(json),
  ];

  Future<TeamDetail> detail(String id) async =>
      TeamDetail.fromJson((await _api.get('/teams/$id')).object);
}
