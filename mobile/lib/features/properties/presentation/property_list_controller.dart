import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../data/properties_repository.dart';
import '../domain/property_summary.dart';

final propertiesRepositoryProvider = Provider<PropertiesRepository>(
  (ref) => PropertiesRepository(ref.watch(apiClientProvider)),
);

/// Danh sách BĐS đã tải (nhiều trang nối nhau).
class PropertyListState {
  const PropertyListState({
    required this.items,
    required this.page,
    required this.total,
    required this.hasMore,
    this.loadingMore = false,
    this.loadMoreError,
  });

  final List<PropertySummary> items;

  /// Trang cuối đã tải.
  final int page;
  final int total;
  final bool hasMore;
  final bool loadingMore;

  /// Lỗi khi tải trang tiếp theo (danh sách đã có vẫn hiện).
  final Object? loadMoreError;

  PropertyListState copyWith({
    List<PropertySummary>? items,
    int? page,
    int? total,
    bool? hasMore,
    bool? loadingMore,
    Object? loadMoreError,
  }) => PropertyListState(
    items: items ?? this.items,
    page: page ?? this.page,
    total: total ?? this.total,
    hasMore: hasMore ?? this.hasMore,
    loadingMore: loadingMore ?? this.loadingMore,
    loadMoreError: loadMoreError,
  );
}

/// Danh sách BĐS: tải trang đầu, cuộn tới cuối thì tải thêm ([loadMore]), kéo xuống thì tải lại ([refresh]).
final propertyListProvider =
    AsyncNotifierProvider.autoDispose<
      PropertyListController,
      PropertyListState
    >(PropertyListController.new, retry: (_, _) => null);

class PropertyListController extends AsyncNotifier<PropertyListState> {
  @override
  Future<PropertyListState> build() => _load(1, const []);

  Future<PropertyListState> _load(
    int page,
    List<PropertySummary> before,
  ) async {
    final result = await ref
        .read(propertiesRepositoryProvider)
        .list(page: page);
    // Bỏ BĐS trùng: BĐS mới thêm trong lúc cuộn làm các trang sau lệch đi một dòng.
    final seen = {for (final item in before) item.id};
    return PropertyListState(
      items: [...before, ...result.items.where((item) => seen.add(item.id))],
      page: page,
      total: result.meta.total,
      hasMore: result.meta.hasNext,
    );
  }

  /// Tải lại từ trang đầu. Đang có danh sách mà tải lại lỗi thì giữ danh sách cũ và trả lỗi để màn hình báo.
  Future<Object?> refresh() async {
    final next = await AsyncValue.guard(() => _load(1, const []));
    if (next.hasError && state.hasValue) {
      return next.error;
    }
    state = next;
    return null;
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || !current.hasMore || current.loadingMore) {
      return;
    }
    state = AsyncData(current.copyWith(loadingMore: true));
    try {
      state = AsyncData(await _load(current.page + 1, current.items));
    } catch (error) {
      state = AsyncData(current.copyWith(loadMoreError: error));
    }
  }
}
