import '../../../core/network/api_client.dart';
import '../domain/ai_match.dart';
import '../domain/ai_search.dart';

/// Gọi API AI của backend. App không bao giờ gọi thẳng nhà cung cấp LLM (TASK-133).
class AiRepository {
  AiRepository(this._api);

  final ApiClient _api;

  Future<AiStatus> status() async =>
      AiStatus.fromJson((await _api.get('/ai/status')).object);

  /// Cần `property.view`. Mỗi lần gọi tính một lượt AI.
  Future<AiPropertySearch> propertySearch(String query) async =>
      AiPropertySearch.fromJson(
        (await _api.post('/ai/property-search', body: {'query': query})).object,
      );

  /// AI giải thích vì sao BĐS [propertyId] phù hợp với khách [customerId] (cần `customer.view`). Mỗi lần gọi
  /// tính một lượt AI. Khách chưa có nhu cầu cùng loại giao dịch → `BUSINESS_RULE_VIOLATION`.
  Future<AiMatchExplanation> matchExplanation(
    String customerId,
    String propertyId,
  ) async => AiMatchExplanation.fromJson(
    (await _api.post(
      '/customers/$customerId/matching-properties/$propertyId/ai-explanation',
    )).object,
  );
}
