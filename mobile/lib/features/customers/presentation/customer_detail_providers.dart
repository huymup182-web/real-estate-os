import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/presentation/session_controller.dart';
import '../domain/customer_detail.dart';
import '../domain/property_match.dart';
import 'customer_list_controller.dart';

/// Chi tiết một khách.
final customerDetailProvider = FutureProvider.autoDispose
    .family<CustomerDetail, String>(
      (ref, id) => ref.watch(customersRepositoryProvider).detail(id),
      retry: (_, _) => null,
    );

/// Nhu cầu của một khách (tải riêng: lỗi phần này không chặn phần thông tin).
final customerPreferencesProvider = FutureProvider.autoDispose
    .family<List<CustomerPreference>, String>(
      (ref, id) => ref.watch(customersRepositoryProvider).preferences(id),
      retry: (_, _) => null,
    );

/// BĐS phù hợp với khách (TASK-090), điểm cao trước. Tải riêng như nhu cầu.
final customerMatchesProvider = FutureProvider.autoDispose
    .family<List<PropertyMatch>, String>(
      (ref, id) =>
          ref.watch(customersRepositoryProvider).matchingProperties(id),
      retry: (_, _) => null,
    );

/// Tên môi giới phụ trách. Không có quyền xem người dùng (`user.view`) hoặc lỗi thì null.
final agentNameProvider = FutureProvider.autoDispose.family<String?, String>((
  ref,
  userId,
) async {
  final user = ref.watch(sessionProvider).value?.user;
  if (user == null || !user.can('user.view')) {
    return null;
  }
  try {
    return await ref.watch(customersRepositoryProvider).userName(userId);
  } on Object {
    return null;
  }
}, retry: (_, _) => null);

/// Timeline chăm sóc đã tải (nhiều trang nối nhau).
class ActivityTimeline {
  const ActivityTimeline({
    required this.items,
    required this.page,
    required this.hasMore,
    this.loadingMore = false,
    this.loadMoreError,
  });

  final List<CustomerActivity> items;
  final int page;
  final bool hasMore;
  final bool loadingMore;
  final Object? loadMoreError;
}

/// Timeline chăm sóc của một khách, xảy ra gần đây trước; "Xem thêm" tải trang sau ([loadMore]).
final customerActivitiesProvider = AsyncNotifierProvider.autoDispose
    .family<CustomerActivities, ActivityTimeline, String>(
      CustomerActivities.new,
      retry: (_, _) => null,
    );

class CustomerActivities extends AsyncNotifier<ActivityTimeline> {
  CustomerActivities(this.customerId);

  final String customerId;

  @override
  Future<ActivityTimeline> build() => _load(1, const []);

  Future<ActivityTimeline> _load(
    int page,
    List<CustomerActivity> before,
  ) async {
    final result = await ref
        .read(customersRepositoryProvider)
        .activities(customerId, page: page);
    final seen = {for (final item in before) item.id};
    return ActivityTimeline(
      items: [...before, ...result.items.where((item) => seen.add(item.id))],
      page: page,
      hasMore: result.meta.hasNext,
    );
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null ||
        state.isLoading ||
        !current.hasMore ||
        current.loadingMore) {
      return;
    }
    state = AsyncData(
      ActivityTimeline(
        items: current.items,
        page: current.page,
        hasMore: current.hasMore,
        loadingMore: true,
      ),
    );
    ActivityTimeline next;
    try {
      next = await _load(current.page + 1, current.items);
    } catch (error) {
      next = ActivityTimeline(
        items: current.items,
        page: current.page,
        hasMore: current.hasMore,
        loadMoreError: error,
      );
    }
    if (ref.mounted) {
      state = AsyncData(next);
    }
  }
}
