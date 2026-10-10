import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/clock.dart';
import '../../../core/providers.dart';
import '../../auth/presentation/session_controller.dart';
import '../data/notifications_repository.dart';
import '../domain/app_notification.dart';

final notificationsRepositoryProvider = Provider<NotificationsRepository>(
  (ref) => NotificationsRepository(ref.watch(apiClientProvider)),
);

/// Số thông báo chưa đọc (chấm đỏ trên tab). Chưa đăng nhập hoặc lỗi → null (ẩn), không báo lỗi.
final unreadCountProvider = FutureProvider.autoDispose<int?>((ref) async {
  if (ref.watch(sessionProvider).value?.user == null) {
    return null;
  }
  try {
    return await ref.watch(notificationsRepositoryProvider).unreadCount();
  } on Object {
    return null;
  }
}, retry: (_, _) => null);

/// Chỉ xem thông báo chưa đọc hay tất cả.
final notificationUnreadOnlyProvider =
    NotifierProvider.autoDispose<UnreadOnly, bool>(UnreadOnly.new);

class UnreadOnly extends Notifier<bool> {
  @override
  bool build() => false;

  void set(bool value) => state = value;
}

class NotificationListState {
  const NotificationListState({
    required this.items,
    required this.page,
    required this.total,
    required this.hasMore,
    this.loadingMore = false,
    this.loadMoreError,
  });

  final List<AppNotification> items;
  final int page;
  final int total;
  final bool hasMore;
  final bool loadingMore;
  final Object? loadMoreError;

  NotificationListState copyWith({
    List<AppNotification>? items,
    bool? loadingMore,
    Object? loadMoreError,
  }) => NotificationListState(
    items: items ?? this.items,
    page: page,
    total: total,
    hasMore: hasMore,
    loadingMore: loadingMore ?? false,
    loadMoreError: loadMoreError,
  );
}

/// Hộp thư thông báo (mới nhất trước), nhiều trang nối nhau, theo [notificationUnreadOnlyProvider].
final notificationListProvider =
    AsyncNotifierProvider.autoDispose<
      NotificationListController,
      NotificationListState
    >(NotificationListController.new, retry: (_, _) => null);

class NotificationListController extends AsyncNotifier<NotificationListState> {
  @override
  Future<NotificationListState> build() => _load(1, const []);

  Future<NotificationListState> _load(
    int page,
    List<AppNotification> before,
  ) async {
    final result = await ref
        .read(notificationsRepositoryProvider)
        .list(
          page: page,
          unreadOnly: ref.watch(notificationUnreadOnlyProvider),
        );
    // Bỏ thông báo trùng: có thông báo mới trong lúc cuộn làm các trang sau lệch đi.
    final seen = {for (final item in before) item.id};
    return NotificationListState(
      items: [...before, ...result.items.where((item) => seen.add(item.id))],
      page: page,
      total: result.meta.total,
      hasMore: result.meta.hasNext,
    );
  }

  /// Tải lại từ trang đầu (và số chưa đọc); lỗi mà đang có danh sách thì giữ danh sách và trả lỗi để báo.
  Future<Object?> refresh() async {
    ref.invalidate(unreadCountProvider);
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
    NotificationListState next;
    try {
      next = await _load(current.page + 1, current.items);
    } catch (error) {
      next = current.copyWith(loadMoreError: error);
    }
    if (ref.mounted) {
      state = AsyncData(next);
    }
  }

  /// Đánh dấu đã đọc [id] (đổi ngay trên màn hình, giữ nguyên chỗ trong danh sách). Lỗi thì trả lại như cũ và
  /// trả lỗi để báo.
  Future<Object?> markRead(String id) async {
    final now = ref.read(clockProvider)();
    _update((item) => item.id == id ? item.markedRead(now) : item);
    try {
      await ref.read(notificationsRepositoryProvider).markRead(id);
    } on Object catch (error) {
      if (ref.mounted) {
        _update((item) => item.id == id ? _unread(item) : item);
      }
      return error;
    }
    if (ref.mounted) {
      ref.invalidate(unreadCountProvider);
    }
    return null;
  }

  /// Đánh dấu đọc tất cả; trả số vừa đánh dấu, hoặc lỗi.
  Future<({int? count, Object? error})> markAllRead() async {
    final int count;
    try {
      count = await ref.read(notificationsRepositoryProvider).markAllRead();
    } on Object catch (error) {
      return (count: null, error: error);
    }
    if (ref.mounted) {
      final now = ref.read(clockProvider)();
      _update((item) => item.markedRead(now));
      ref.invalidate(unreadCountProvider);
    }
    return (count: count, error: null);
  }

  void _update(AppNotification Function(AppNotification item) change) {
    final current = state.value;
    if (current != null) {
      state = AsyncData(
        current.copyWith(
          items: current.items.map(change).toList(),
          loadingMore: current.loadingMore,
          loadMoreError: current.loadMoreError,
        ),
      );
    }
  }

  static AppNotification _unread(AppNotification item) => AppNotification(
    id: item.id,
    type: item.type,
    title: item.title,
    body: item.body,
    data: item.data,
    createdAt: item.createdAt,
  );
}
