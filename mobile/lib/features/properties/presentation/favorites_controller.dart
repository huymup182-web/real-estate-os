import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/property_query.dart';
import '../domain/property_summary.dart';
import 'property_list_controller.dart';

/// Trạng thái yêu thích người dùng vừa đổi trên app (id BĐS → đã lưu hay chưa). Danh sách, chi tiết đã tải giữ
/// giá trị cũ, nên chỗ hiện nút tim lấy giá trị ở đây trước ([isFavorite]).
final favoriteOverridesProvider =
    NotifierProvider.autoDispose<FavoriteOverrides, Map<String, bool>>(
      FavoriteOverrides.new,
    );

class FavoriteOverrides extends Notifier<Map<String, bool>> {
  final _pending = <String>{};

  @override
  Map<String, bool> build() => const {};

  /// Đổi ngay trên màn hình rồi gọi API; lỗi thì trả lại như cũ và trả lỗi để báo. Đang gửi cho BĐS này thì
  /// bỏ qua lần bấm mới.
  Future<Object?> set(
    String propertyId, {
    required bool favorite,
    required bool current,
  }) async {
    if (!_pending.add(propertyId)) {
      return null;
    }
    state = {...state, propertyId: favorite};
    try {
      await ref
          .read(propertiesRepositoryProvider)
          .setFavorite(propertyId, favorite: favorite);
      if (ref.mounted) {
        ref.invalidate(favoriteListProvider);
      }
      return null;
    } on Object catch (error) {
      if (ref.mounted) {
        state = {...state, propertyId: current};
      }
      return error;
    } finally {
      _pending.remove(propertyId);
    }
  }
}

/// BĐS [propertyId] có đang trong yêu thích không: giá trị vừa đổi trên app, không có thì [loaded] (từ API).
bool isFavorite(Map<String, bool> overrides, String propertyId, bool loaded) =>
    overrides[propertyId] ?? loaded;

/// Danh sách BĐS yêu thích (mới lưu trước), nhiều trang nối nhau.
final favoriteListProvider =
    AsyncNotifierProvider.autoDispose<
      FavoriteListController,
      PropertyListState
    >(FavoriteListController.new, retry: (_, _) => null);

class FavoriteListController extends AsyncNotifier<PropertyListState> {
  @override
  Future<PropertyListState> build() => _load(1, const []);

  Future<PropertyListState> _load(
    int page,
    List<PropertySummary> before,
  ) async {
    final result = await ref
        .read(propertiesRepositoryProvider)
        .favorites(page: page);
    // Bỏ BĐS trùng: lưu thêm BĐS trong lúc cuộn làm các trang sau lệch đi.
    final seen = {for (final item in before) item.id};
    return PropertyListState(
      query: const PropertyQuery(),
      items: [...before, ...result.items.where((item) => seen.add(item.id))],
      page: page,
      total: result.meta.total,
      hasMore: result.meta.hasNext,
    );
  }

  /// Tải lại từ trang đầu; lỗi mà đang có danh sách thì giữ danh sách và trả lỗi để báo.
  Future<Object?> refresh() async {
    final next = await AsyncValue.guard(() => _load(1, const []));
    if (!ref.mounted) {
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
        !current.hasMore ||
        current.loadingMore) {
      return;
    }
    state = AsyncData(current.copyWith(loadingMore: true));
    PropertyListState next;
    try {
      next = await _load(current.page + 1, current.items);
    } catch (error) {
      next = current.copyWith(loadMoreError: error);
    }
    if (ref.mounted) {
      state = AsyncData(next);
    }
  }
}
