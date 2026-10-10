import 'package:real_estate_os/features/ai/data/ai_repository.dart';
import 'package:real_estate_os/features/ai/domain/ai_copilot.dart';
import 'package:real_estate_os/features/ai/domain/ai_customer_summary.dart';
import 'package:real_estate_os/features/ai/domain/ai_follow_up.dart';
import 'package:real_estate_os/features/ai/domain/ai_listing.dart';
import 'package:real_estate_os/features/ai/domain/ai_match.dart';
import 'package:real_estate_os/features/ai/domain/ai_search.dart';
import 'package:real_estate_os/features/ai/domain/ai_valuation.dart';
import 'package:real_estate_os/features/ai/domain/ai_video.dart';

/// AiRepository giả: [status] trả về từ `GET /ai/status`; [onSearch] trả kết quả tìm bằng AI; [onExplain] trả
/// lời AI giải thích matching; [onListing] trả tin AI viết; [onValuation] trả định giá AI; [onVideo] trả kịch bản video AI.
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
  Future<AiValuation> Function(String propertyId) onValuation =
      (propertyId) async => AiValuation.fromJson(const {
        'estimate': {'price': 5060000000, 'pricePerM2': 63250000},
        'range': {'low': 4730000000, 'high': 5500000000},
        'base': {'price': 4600000000, 'pricePerM2': 57500000},
        'adjustmentPercent': 10,
        'maxAdjustmentPercent': 10,
        'confidence': 'MEDIUM',
        'factors': [
          {
            'factor': 'Pháp lý',
            'impact': 'UP',
            'note': 'Sổ riêng, tốt hơn căn sổ chung.',
          },
          {
            'factor': 'Diện tích',
            'impact': 'NEUTRAL',
            'note': 'Gần bằng các căn tương tự.',
          },
        ],
        'summary': 'Giá ước tính dựa trên 4 BĐS tương tự cùng khu vực.',
        'comparables': [
          {
            'id': 'p2',
            'code': 'BDS-000002',
            'title': 'Nhà phố Vĩnh Hải',
            'status': 'SOLD',
            'price': 4000000000,
            'area': 80,
            'pricePerM2': 50000000,
            'sameWard': true,
          },
          {
            'id': 'p3',
            'code': 'BDS-000003',
            'title': 'Nhà phố Lộc Thọ',
            'status': 'AVAILABLE',
            'price': 6300000000,
            'area': 90,
            'pricePerM2': 70000000,
            'sameWard': false,
          },
        ],
        'askingPrice': 5000000000,
        'askingVsEstimatePercent': -1.2,
      });
  final valuations = <String>[];
  Future<AiVideo> Function(String propertyId, int durationSeconds) onVideo =
      (propertyId, durationSeconds) async => AiVideo.fromJson(const {
        'property': {'id': 'p1', 'code': 'BDS-000001'},
        'durationSeconds': 15,
        'scenes': [
          {
            'kind': 'INTRO',
            'imageUrl': 'https://cdn.test/1.jpg',
            'durationSeconds': 5,
            'title': 'Nhà phố Vĩnh Hải mới xây',
          },
          {
            'kind': 'FACTS',
            'imageUrl': 'https://cdn.test/2.jpg',
            'durationSeconds': 5,
            'title': 'Thông tin',
            'lines': ['Giá 5 tỷ', 'Diện tích 80 m²', 'Vĩnh Hải, Khánh Hòa'],
          },
          {
            'kind': 'CTA',
            'imageUrl': 'https://cdn.test/1.jpg',
            'durationSeconds': 5,
            'title': 'Nhắn tin để đi xem nhà',
            'lines': ['Liên hệ để xem nhà'],
          },
        ],
      });
  final videos = <(String, int)>[];
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
  Future<CopilotTurn> Function(List<CopilotTurn> history) onCopilot =
      (history) async => const CopilotTurn.assistant(
        'Căn BDS-000001 hợp với khách: đúng phường, trong ngân sách.',
        properties: [
          CopilotProperty(
            id: 'p1',
            code: 'BDS-000001',
            title: 'Nhà phố Vĩnh Hải',
            price: 3500000000,
            area: 70.5,
          ),
        ],
        customers: [
          CopilotCustomer(
            ref: 'K1',
            id: 'c1',
            fullName: 'Trần Thị Bình',
            status: 'VIEWING',
          ),
        ],
      );

  /// Mỗi lần hỏi Copilot: các lượt đã gửi và ngữ cảnh.
  final copilotCalls = <(List<CopilotTurn>, CopilotContext)>[];
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
  Future<AiVideo> video(String propertyId, int durationSeconds) {
    videos.add((propertyId, durationSeconds));
    return onVideo(propertyId, durationSeconds);
  }

  @override
  Future<AiValuation> valuation(String propertyId) {
    valuations.add(propertyId);
    return onValuation(propertyId);
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

  @override
  Future<CopilotTurn> copilot(
    List<CopilotTurn> history,
    CopilotContext context,
  ) {
    copilotCalls.add((List.of(history), context));
    return onCopilot(history);
  }
}
