import '../../../core/network/api_client.dart';
import '../domain/ai_copilot.dart';
import '../domain/ai_customer_summary.dart';
import '../domain/ai_follow_up.dart';
import '../domain/ai_listing.dart';
import '../domain/ai_match.dart';
import '../domain/ai_search.dart';
import '../domain/ai_valuation.dart';
import '../domain/ai_video.dart';

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

  /// AI viết tin đăng cho BĐS [propertyId] (cần `property.view`). Mỗi lần gọi tính một lượt AI.
  Future<AiListing> listing(String propertyId, AiListingStyle style) async =>
      AiListing.fromJson(
        (await _api.post(
          '/properties/$propertyId/ai-listing',
          body: {'style': style.code},
        )).object,
      );

  /// Định giá AI BĐS [propertyId] từ BĐS tương tự (cần `property.view`). Mỗi lần gọi tính một lượt AI; dưới 3 BĐS
  /// tương tự → `BUSINESS_RULE_VIOLATION`, không tính lượt.
  Future<AiValuation> valuation(String propertyId) async =>
      AiValuation.fromJson(
        (await _api.post('/properties/$propertyId/ai-valuation')).object,
      );

  /// Kịch bản video AI dài [durationSeconds] giây từ ảnh và dữ liệu BĐS [propertyId] (cần `property.view`). Mỗi lần
  /// gọi tính một lượt AI; BĐS chưa có ảnh → `BUSINESS_RULE_VIOLATION`, không tính lượt.
  Future<AiVideo> video(String propertyId, int durationSeconds) async =>
      AiVideo.fromJson(
        (await _api.post(
          '/properties/$propertyId/ai-video',
          body: {'durationSeconds': durationSeconds},
        )).object,
      );

  /// AI tóm tắt nhu cầu và lịch sử chăm sóc khách [customerId] (cần `customer.view`). Mỗi lần gọi tính một lượt AI.
  Future<AiCustomerSummary> customerSummary(String customerId) async =>
      AiCustomerSummary.fromJson(
        (await _api.post('/customers/$customerId/ai-summary')).object,
      );

  /// Tối đa 10 khách cần chăm sóc trong phạm vi xem, kèm gợi ý của AI (cần `customer.view`). Có khách thì tính
  /// một lượt AI; không có khách nào thì không gọi AI.
  Future<AiFollowUps> followUps() async =>
      AiFollowUps.fromJson((await _api.post('/ai/follow-ups')).object);

  /// Hỏi Copilot (TASK-143). [history] là các lượt trước và câu hỏi mới ở cuối; backend không lưu hội thoại.
  /// Mỗi lần Copilot gọi LLM tính một lượt AI, một câu hỏi tối đa 4 lượt.
  Future<CopilotTurn> copilot(
    List<CopilotTurn> history,
    CopilotContext context,
  ) async => CopilotTurn.fromReply(
    (await _api.post(
      '/ai/copilot',
      body: {
        'messages': [for (final turn in history) turn.toJson()],
        if (context.toJson().isNotEmpty) 'context': context.toJson(),
      },
    )).object,
  );
}
