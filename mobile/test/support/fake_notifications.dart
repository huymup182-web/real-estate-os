import 'package:real_estate_os/core/network/api_response.dart';
import 'package:real_estate_os/core/network/page.dart';
import 'package:real_estate_os/features/notifications/data/notifications_repository.dart';
import 'package:real_estate_os/features/notifications/domain/app_notification.dart';

/// Một thông báo mẫu.
AppNotification notification(
  int index, {
  String type = 'SYSTEM_NOTIFICATION',
  Map<String, dynamic> data = const {},
  DateTime? readAt,
  DateTime? createdAt,
}) => AppNotification(
  id: 'n$index',
  type: type,
  title: 'Thông báo $index',
  body: 'Nội dung $index',
  data: data,
  readAt: readAt,
  createdAt:
      createdAt ??
      DateTime.utc(2026, 10, 16, 1).subtract(Duration(hours: index)),
);

/// NotificationsRepository giả, giữ hộp thư [items] (mới nhất trước) và trả theo trang [pageSize].
class FakeNotificationsRepository implements NotificationsRepository {
  FakeNotificationsRepository([this.items = const [], this.pageSize = 20]);

  List<AppNotification> items;
  final int pageSize;
  Object? failList;
  Object? failMarkRead;
  Object? failMarkAll;
  final listCalls = <({int page, bool unreadOnly})>[];
  final markedRead = <String>[];
  int unreadCountCalls = 0;
  int markAllCalls = 0;

  @override
  Future<Page<AppNotification>> list({
    required int page,
    bool unreadOnly = false,
  }) async {
    listCalls.add((page: page, unreadOnly: unreadOnly));
    if (failList case final error?) {
      throw error;
    }
    final all = [
      for (final item in items)
        if (!unreadOnly || item.unread) item,
    ];
    final start = (page - 1) * pageSize;
    final totalPages = (all.length / pageSize).ceil();
    return Page(
      items: all.skip(start).take(pageSize).toList(),
      meta: PageMeta(
        page: page,
        pageSize: pageSize,
        total: all.length,
        totalPages: totalPages,
      ),
    );
  }

  @override
  Future<int> unreadCount() async {
    unreadCountCalls++;
    return items.where((item) => item.unread).length;
  }

  @override
  Future<AppNotification> markRead(String id) async {
    markedRead.add(id);
    if (failMarkRead case final error?) {
      throw error;
    }
    final at = DateTime.utc(2026, 10, 16, 1);
    items = [
      for (final item in items) item.id == id ? item.markedRead(at) : item,
    ];
    return items.firstWhere((item) => item.id == id);
  }

  @override
  Future<int> markAllRead() async {
    markAllCalls++;
    if (failMarkAll case final error?) {
      throw error;
    }
    final count = items.where((item) => item.unread).length;
    final at = DateTime.utc(2026, 10, 16, 1);
    items = [for (final item in items) item.markedRead(at)];
    return count;
  }
}
