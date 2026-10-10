import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../data/customers_repository.dart';
import '../domain/customer_query.dart';
import '../domain/customer_summary.dart';

final customersRepositoryProvider = Provider<CustomersRepository>(
  (ref) => CustomersRepository(ref.watch(apiClientProvider)),
);

/// Điều kiện tìm đang dùng ở tab Khách hàng. Đổi thì danh sách tải lại từ trang đầu.
final customerQueryProvider =
    NotifierProvider.autoDispose<CustomerQueryController, CustomerQuery>(
      CustomerQueryController.new,
    );

class CustomerQueryController extends Notifier<CustomerQuery> {
  @override
  CustomerQuery build() => const CustomerQuery();

  void setKeyword(String text) => _set(state.withKeyword(text));

  /// Bật/tắt lọc một bước pipeline.
  void toggleStatus(String status) => _set(
    state.withStatuses(
      state.statuses.contains(status)
          ? ({...state.statuses}..remove(status))
          : {...state.statuses, status},
    ),
  );

  void clearStatuses() => _set(state.withStatuses(const {}));

  /// Chỉ lọc một bước (mở từ màn pipeline).
  void showOnly(String status) => _set(state.withStatuses({status}));

  void _set(CustomerQuery next) {
    if (next != state) {
      state = next;
    }
  }
}

/// Danh sách khách đã tải (nhiều trang nối nhau) cho một điều kiện tìm.
class CustomerListState {
  const CustomerListState({
    required this.query,
    required this.items,
    required this.page,
    required this.total,
    required this.hasMore,
    this.loadingMore = false,
    this.loadMoreError,
  });

  final CustomerQuery query;
  final List<CustomerSummary> items;
  final int page;
  final int total;
  final bool hasMore;
  final bool loadingMore;

  /// Lỗi khi tải trang tiếp theo (danh sách đã có vẫn hiện).
  final Object? loadMoreError;

  CustomerListState copyWith({bool? loadingMore, Object? loadMoreError}) =>
      CustomerListState(
        query: query,
        items: items,
        page: page,
        total: total,
        hasMore: hasMore,
        loadingMore: loadingMore ?? this.loadingMore,
        loadMoreError: loadMoreError,
      );
}

/// Danh sách khách: tải trang đầu, cuộn tới cuối thì tải thêm ([loadMore]), kéo xuống thì tải lại ([refresh]).
final customerListProvider =
    AsyncNotifierProvider.autoDispose<
      CustomerListController,
      CustomerListState
    >(CustomerListController.new, retry: (_, _) => null);

class CustomerListController extends AsyncNotifier<CustomerListState> {
  @override
  Future<CustomerListState> build() =>
      _load(ref.watch(customerQueryProvider), 1, const []);

  Future<CustomerListState> _load(
    CustomerQuery query,
    int page,
    List<CustomerSummary> before,
  ) async {
    final result = await ref
        .read(customersRepositoryProvider)
        .list(page: page, query: query);
    // Bỏ khách trùng: khách mới thêm trong lúc cuộn làm các trang sau lệch đi.
    final seen = {for (final item in before) item.id};
    return CustomerListState(
      query: query,
      items: [...before, ...result.items.where((item) => seen.add(item.id))],
      page: page,
      total: result.meta.total,
      hasMore: result.meta.hasNext,
    );
  }

  /// Tải lại từ trang đầu. Đang có danh sách mà lỗi thì giữ danh sách cũ và trả lỗi để màn hình báo.
  Future<Object?> refresh() async {
    final query = ref.read(customerQueryProvider);
    final next = await AsyncValue.guard(() => _load(query, 1, const []));
    if (!ref.mounted || ref.read(customerQueryProvider) != query) {
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
    if (current == null ||
        state.isLoading ||
        current.query != ref.read(customerQueryProvider) ||
        !current.hasMore ||
        current.loadingMore) {
      return;
    }
    state = AsyncData(current.copyWith(loadingMore: true));
    CustomerListState next;
    try {
      next = await _load(current.query, current.page + 1, current.items);
    } catch (error) {
      next = current.copyWith(loadMoreError: error);
    }
    // Đổi điều kiện trong lúc chờ thì danh sách đã tải lại: bỏ kết quả cũ.
    if (ref.mounted && ref.read(customerQueryProvider) == current.query) {
      state = AsyncData(next);
    }
  }
}
