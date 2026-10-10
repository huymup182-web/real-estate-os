import 'package:real_estate_os/features/ai/data/ai_repository.dart';
import 'package:real_estate_os/features/ai/domain/ai_customer_summary.dart';
import 'package:real_estate_os/features/ai/domain/ai_follow_up.dart';
import 'package:real_estate_os/features/ai/domain/ai_listing.dart';
import 'package:real_estate_os/features/ai/domain/ai_match.dart';
import 'package:real_estate_os/features/ai/domain/ai_search.dart';

/// AiRepository giả: [status] trả về từ `GET /ai/status`; [onSearch] trả kết quả tìm bằng AI; [onExplain] trả
/// lời AI giải thích matching; [onListing] trả tin AI viết.
class FakeAiRepository implements AiRepository {
  FakeAiRepository({
    this.currentStatus = const AiStatus(
      enabled: true,
      dailyLimit: 100,
      remaining: 99,
    ),
    Future<AiPropertySearch> Function(String query)? onSearch,
  }) : onSearch =
           onSearch ??
           ((_) async => AiPropertySearch.fromJson(const {
             'filters': {'priceMax': 5000000000},
             'explanation': 'Giá tối đa 5 tỷ.',
             'unresolved': <String>[],
           }));

  Future<AiMatchExplanation> Function(String customerId, String propertyId)
  onExplain = (customerId, propertyId) async => const AiMatchExplanation(
    score: 88,
    summary: 'Nhà hợp ngân sách và khu vực khách cần.',
    strengths: ['Giá 4,8 tỷ nằm trong ngân sách 4–5 tỷ.'],
    concerns: ['Hướng Tây, khách chưa nêu hướng: nên hỏi thêm.'],
    pitch: 'Căn này đúng tầm giá anh chị đang tìm.',
  );
  final explanations = <(String, String)>[];
  Future<AiListing> Function(String propertyId, AiListingStyle style)
  onListing = (propertyId, style) async => AiListing(
    style: style,
    title: 'Bán nhà phố Vĩnh Hải (${style.label})',
    description: 'Nhà mới xây gần chợ.\nGiá 3,5 tỷ, 70,5 m².',
  );
  final listings = <(String, AiListingStyle)>[];
  Future<AiCustomerSummary> Function(String customerId) onSummary =
      (customerId) async => const AiCustomerSummary(
        summary:
            'Khách cần nhà phố ở Vĩnh Hải 4–6 tỷ, đã hẹn xem nhà cuối tuần.',
        keyPoints: ['Muốn gần trường học.'],
        openQuestions: ['Khách cần mấy phòng tắm?'],
        activityCount: 2,
      );
  final summaries = <String>[];
  Future<AiFollowUps> Function() onFollowUps = () async => const AiFollowUps(
    thresholdDays: 14,
    items: [
      AiFollowUpItem(
        customerId: 'c1',
        fullName: 'Trần Thị Bình',
        status: 'VIEWING',
        daysSinceContact: 16,
        action: 'CALL',
        reason: 'Khách đã đi xem, 16 ngày chưa gọi.',
        message: 'Em chào chị, chị còn quan tâm căn Vĩnh Hải không ạ?',
      ),
      AiFollowUpItem(
        customerId: 'c2',
        fullName: 'Lê Văn Cường',
        status: 'NEW',
        daysSinceContact: 20,
      ),
    ],
  );
  int followUpCalls = 0;
  AiStatus currentStatus;
  Future<AiPropertySearch> Function(String query) onSearch;
  int statusCalls = 0;
  final searches = <String>[];

  @override
  Future<AiStatus> status() async {
    statusCalls++;
    return currentStatus;
  }

  @override
  Future<AiPropertySearch> propertySearch(String query) {
    searches.add(query);
    return onSearch(query);
  }

  @override
  Future<AiMatchExplanation> matchExplanation(
    String customerId,
    String propertyId,
  ) {
    explanations.add((customerId, propertyId));
    return onExplain(customerId, propertyId);
  }

  @override
  Future<AiListing> listing(String propertyId, AiListingStyle style) {
    listings.add((propertyId, style));
    return onListing(propertyId, style);
  }

  @override
  Future<AiCustomerSummary> customerSummary(String customerId) {
    summaries.add(customerId);
    return onSummary(customerId);
  }

  @override
  Future<AiFollowUps> followUps() {
    followUpCalls++;
    return onFollowUps();
  }
}
