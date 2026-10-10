import '../../../core/network/api_client.dart';
import '../../../core/network/page.dart';
import '../domain/app_notification.dart';

/// Gọi API hộp thư thông báo của người đang đăng nhập (chỉ cần đăng nhập).
class NotificationsRepository {
  NotificationsRepository(this._api);

  final ApiClient _api;

  static const pageSize = 20;

  /// Mới nhất trước; [unreadOnly] thì chỉ thông báo chưa đọc.
  Future<Page<AppNotification>> list({
    required int page,
    bool unreadOnly = false,
  }) async => Page.from(
    await _api.get(
      '/notifications',
      query: {
        if (unreadOnly) 'unread': 'true',
        'page': page,
        'pageSize': pageSize,
      },
    ),
    AppNotification.fromJson,
  );

  Future<int> unreadCount() async =>
      ((await _api.get('/notifications/unread-count')).object['count'] as num)
          .toInt();

  Future<AppNotification> markRead(String id) async => AppNotification.fromJson(
    (await _api.post('/notifications/$id/read')).object,
  );

  /// Trả số thông báo vừa đánh dấu đã đọc.
  Future<int> markAllRead() async =>
      ((await _api.post('/notifications/read-all')).object['count'] as num)
          .toInt();
}
