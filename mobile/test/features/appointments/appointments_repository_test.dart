import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/network/api_client.dart';
import 'package:real_estate_os/core/storage/token_storage.dart';
import 'package:real_estate_os/features/appointments/data/appointments_repository.dart';

import '../../support/fake_adapter.dart';

Map<String, dynamic> _json(String id, {String? outcome}) => {
  'id': id,
  'customer': {'id': 'c1', 'fullName': 'Trần Thị Bình'},
  'property': {'id': 'p1', 'code': 'BDS-0001', 'title': 'Nhà phố Vĩnh Hải'},
  'agentId': 'u1',
  'scheduledAt': '2026-10-16T02:30:00.000Z',
  'durationMinutes': 45,
  'location': 'Số 1 Đường 2/4',
  'notes': null,
  'status': outcome == null ? 'SCHEDULED' : 'COMPLETED',
  'outcome': outcome,
  'createdAt': '2026-10-01T00:00:00.000Z',
  'updatedAt': '2026-10-02T00:00:00.000Z',
};

void main() {
  late FakeAdapter adapter;
  late AppointmentsRepository repository;

  setUp(() {
    adapter = FakeAdapter((options) {
      if (options.path == '/appointments') {
        final page = options.queryParameters['page'] as int;
        return (
          200,
          {
            'success': true,
            'message': null,
            'data': [_json('a$page')],
            'meta': {
              'page': page,
              'pageSize': 100,
              'total': 2,
              'totalPages': 2,
            },
          },
        );
      }
      return (
        200,
        {
          'success': true,
          'message': null,
          'data': _json('a1', outcome: 'INTERESTED'),
        },
      );
    });
    repository = AppointmentsRepository(
      ApiClient(
        baseUrl: 'https://api.example.vn/api/v1',
        tokens: MemoryTokenStorage(),
        dio: Dio()..httpClientAdapter = adapter,
      ),
    );
  });

  test('range: gửi from/to UTC, tải hết các trang, đọc khách và BĐS', () async {
    final items = await repository.range(
      DateTime.utc(2026, 9, 30, 17),
      DateTime.utc(2026, 10, 31, 17),
    );
    expect(adapter.requests.map((r) => r.options.queryParameters), [
      {
        'from': '2026-09-30T17:00:00.000Z',
        'to': '2026-10-31T17:00:00.000Z',
        'page': 1,
        'pageSize': 100,
      },
      {
        'from': '2026-09-30T17:00:00.000Z',
        'to': '2026-10-31T17:00:00.000Z',
        'page': 2,
        'pageSize': 100,
      },
    ]);
    expect(items.map((item) => item.id), ['a1', 'a2']);
    final first = items.first;
    expect(first.customerName, 'Trần Thị Bình');
    expect(first.propertyCode, 'BDS-0001');
    expect(first.endsAt, DateTime.utc(2026, 10, 16, 3, 15));
    expect(first.updatedAt, DateTime.utc(2026, 10, 2));
  });

  test('changeStatus: kết quả chỉ gửi kèm COMPLETED', () async {
    final updated = await repository.changeStatus(
      'a1',
      status: 'COMPLETED',
      outcome: 'INTERESTED',
      expectedUpdatedAt: DateTime.utc(2026, 10, 2),
    );
    await repository.changeStatus(
      'a1',
      status: 'CANCELLED',
      outcome: 'INTERESTED',
      expectedUpdatedAt: DateTime.utc(2026, 10, 2),
    );
    expect(adapter.requests.first.options.method, 'POST');
    expect(adapter.requests.first.options.path, '/appointments/a1/status');
    expect(adapter.requests.map((r) => r.body), [
      {
        'status': 'COMPLETED',
        'outcome': 'INTERESTED',
        'expectedUpdatedAt': '2026-10-02T00:00:00.000Z',
      },
      {'status': 'CANCELLED', 'expectedUpdatedAt': '2026-10-02T00:00:00.000Z'},
    ]);
    expect(updated.outcome, 'INTERESTED');
  });
}
