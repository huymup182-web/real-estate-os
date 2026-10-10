import 'package:real_estate_os/features/ai/data/ai_repository.dart';
import 'package:real_estate_os/features/ai/domain/ai_search.dart';

/// AiRepository giả: [status] trả về từ `GET /ai/status`; [onSearch] trả kết quả tìm bằng AI.
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
}
