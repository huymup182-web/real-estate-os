import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../data/properties_repository.dart';
import '../domain/property_query.dart';
import '../domain/property_summary.dart';

final propertiesRepositoryProvider = Provider<PropertiesRepository>(
  (ref) => PropertiesRepository(ref.watch(apiClientProvider)),
);

/// Điều kiện tìm đang dùng ở tab BĐS. Đổi thì danh sách tải lại từ trang đầu.
final propertyQueryProvider =
    NotifierProvider.autoDispose<PropertyQueryController, PropertyQuery>(
      PropertyQueryController.new,
    );

class PropertyQueryController extends Notifier<PropertyQuery> {
  @override
  PropertyQuery build() => const PropertyQuery();

  /// Đặt từ khoá; chỉ khác khoảng trắng thì không tìm lại.
  void setKeyword(String text) => _set(state.withKeyword(text));

  /// Áp bộ lọc, sắp xếp của [filters] (giữ từ khoá).
  void applyFilters(PropertyQuery filters) => _set(state.withFilters(filters));

  void clearFilters() => _set(state.withoutFilters());

  /// Thay toàn bộ điều kiện tìm (từ khoá và bộ lọc), vd bằng kết quả tìm bằng AI (TASK-134).
  void replace(PropertyQuery query) => _set(query);

  void _set(PropertyQuery next) {
    if (next != state) {
      state = next;
    }
  }
}

/// Danh sách BĐS đã tải (nhiều trang nối nhau) cho một điều kiện tìm.
class PropertyListState {
  const PropertyListState({
    required this.query,
    required this.items,
    required this.page,
    required this.total,
    required this.hasMore,
    this.loadingMore = false,
    this.loadMoreError,
  });

  final PropertyQuery query;
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
    query: query,
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
  Future<PropertyListState> build() =>
      _load(ref.watch(propertyQueryProvider), 1, const []);

  Future<PropertyListState> _load(
    PropertyQuery query,
    int page,
    List<PropertySummary> before,
  ) async {
    final result = await ref
        .read(propertiesRepositoryProvider)
        .list(page: page, query: query);
    // Bỏ BĐS trùng: BĐS mới thêm trong lúc cuộn làm các trang sau lệch đi một dòng.
    final seen = {for (final item in before) item.id};
    return PropertyListState(
      query: query,
      items: [...before, ...result.items.where((item) => seen.add(item.id))],
      page: page,
      total: result.meta.total,
      hasMore: result.meta.hasNext,
    );
  }

  /// Tải lại từ trang đầu. Đang có danh sách mà tải lại lỗi thì giữ danh sách cũ và trả lỗi để màn hình báo.
  Future<Object?> refresh() async {
    final query = ref.read(propertyQueryProvider);
    final next = await AsyncValue.guard(() => _load(query, 1, const []));
    if (!ref.mounted || ref.read(propertyQueryProvider) != query) {
      return null;
    }
    if (next.hasError && state.hasValue) {
      return next.error;
    }
    state = next;
    return null;
  }

  Future<void> loadMore() async {
    final current = state.value;
    // Đang tải lại cho từ khoá mới thì state.value vẫn là danh sách cũ: không tải thêm cho nó.
    if (current == null ||
        state.isLoading ||
        current.query != ref.read(propertyQueryProvider) ||
        !current.hasMore ||
        current.loadingMore) {
      return;
    }
    state = AsyncData(current.copyWith(loadingMore: true));
    PropertyListState next;
    try {
      next = await _load(current.query, current.page + 1, current.items);
    } catch (error) {
      next = current.copyWith(loadMoreError: error);
    }
    // Đổi từ khoá trong lúc chờ thì danh sách đã tải lại cho từ khoá mới: bỏ kết quả cũ.
    if (ref.mounted && ref.read(propertyQueryProvider) == current.query) {
      state = AsyncData(next);
    }
  }
}
