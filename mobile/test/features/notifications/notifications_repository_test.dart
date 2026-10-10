import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/network/api_client.dart';
import 'package:real_estate_os/core/storage/token_storage.dart';
import 'package:real_estate_os/features/notifications/data/notifications_repository.dart';
import 'package:real_estate_os/features/notifications/domain/app_notification.dart';
import 'package:real_estate_os/features/notifications/presentation/notification_link.dart';

import '../../support/fake_adapter.dart';

const _id = '7d3c1f9e-2b4a-4c6d-8e0f-1a2b3c4d5e6f';
const _id2 = '0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9';

Map<String, dynamic> _json({String? readAt}) => {
  'id': 'n1',
  'type': 'VIEWING_REMINDER',
  'title': 'Sắp tới giờ hẹn',
  'body': '09:30 dẫn khách xem BDS-0001',
  'data': {'appointmentId': _id},
  'readAt': readAt,
  'createdAt': '2026-10-16T01:30:00.000Z',
};

AppNotification _with(String type, Map<String, dynamic> data) =>
    AppNotification(
      id: 'n',
      type: type,
      title: 't',
      body: 'b',
      data: data,
      createdAt: DateTime.utc(2026),
    );

void main() {
  late FakeAdapter adapter;
  late NotificationsRepository repository;

  setUp(() {
    adapter = FakeAdapter(
      (options) => (
        200,
        switch (options.path) {
          '/notifications' => {
            'success': true,
            'message': null,
            'data': [_json()],
            'meta': {'page': 1, 'pageSize': 20, 'total': 1, 'totalPages': 1},
          },
          '/notifications/n1/read' => {
            'success': true,
            'message': null,
            'data': _json(readAt: '2026-10-16T02:00:00.000Z'),
          },
          _ => {
            'success': true,
            'message': null,
            'data': {'count': 4},
          },
        },
      ),
    );
    repository = NotificationsRepository(
      ApiClient(
        baseUrl: 'https://api.example.vn/api/v1',
        tokens: MemoryTokenStorage(),
        dio: Dio()..httpClientAdapter = adapter,
      ),
    );
  });

  test('list: theo trang, lọc chưa đọc; đọc thông báo', () async {
    final page = await repository.list(page: 1);
    await repository.list(page: 2, unreadOnly: true);
    expect(adapter.requests.map((r) => r.options.queryParameters), [
      {'page': 1, 'pageSize': 20},
      {'unread': 'true', 'page': 2, 'pageSize': 20},
    ]);
    final item = page.items.single;
    expect(item.type, 'VIEWING_REMINDER');
    expect(item.unread, isTrue);
    expect(item.createdAt, DateTime.utc(2026, 10, 16, 1, 30));
  });

  test('unread-count, đánh dấu đã đọc, đọc tất cả', () async {
    expect(await repository.unreadCount(), 4);
    final read = await repository.markRead('n1');
    expect(read.readAt, DateTime.utc(2026, 10, 16, 2));
    expect(await repository.markAllRead(), 4);
    expect(
      adapter.requests.map((r) => '${r.options.method} ${r.options.path}'),
      [
        'GET /notifications/unread-count',
        'POST /notifications/n1/read',
        'POST /notifications/read-all',
      ],
    );
  });

  test('màn hình liên quan theo dữ liệu thông báo', () {
    expect(
      notificationLink(_with('VIEWING_REMINDER', {'appointmentId': _id})),
      '/home/calendar',
    );
    expect(
      notificationLink(_with('NEW_PROPERTY', {'propertyId': _id})),
      '/properties/$_id',
    );
    expect(
      notificationLink(_with('CUSTOMER_ASSIGNED', {'customerId': _id})),
      '/customers/$_id',
    );
    expect(
      notificationLink(
        _with('VERIFY_REQUIRED', {
          'propertyIds': [_id],
        }),
      ),
      '/properties/$_id',
    );
    expect(
      notificationLink(
        _with('VERIFY_REQUIRED', {
          'propertyIds': [_id, _id2],
        }),
      ),
      '/properties',
    );
    expect(notificationLink(_with('SYSTEM_NOTIFICATION', {})), isNull);
    // Id lạ (không phải UUID) thì bỏ qua, không mở đường dẫn tuỳ ý.
    expect(
      notificationLink(_with('NEW_PROPERTY', {'propertyId': '../admin'})),
      isNull,
    );
    expect(
      notificationLink(
        _with('VERIFY_REQUIRED', {
          'propertyIds': ['x'],
        }),
      ),
      isNull,
    );
  });
}
