import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/network/api_client.dart';
import 'package:real_estate_os/core/storage/token_storage.dart';
import 'package:real_estate_os/features/home/data/home_repository.dart';

import '../../support/fake_adapter.dart';

void main() {
  late FakeAdapter adapter;
  late HomeRepository repository;

  setUp(() {
    adapter = FakeAdapter(
      (options) => switch (options.path) {
        '/reports/dashboard' => (
          200,
          {
            'success': true,
            'message': null,
            'data': {
              'scope': 'OWN',
              'properties': {'total': 10, 'new': 2, 'active': 7},
              'customers': {'total': 5, 'new': 3},
              'viewings': 4,
              'deals': {'new': 1, 'won': 1, 'revenue': 3500000000},
              'agents': 1,
              'leadFunnel': <Object>[],
              'salesFunnel': <Object>[],
            },
          },
        ),
        _ => (
          200,
          {
            'success': true,
            'message': null,
            'data': [
              {
                'id': 'a1',
                'customer': {'id': 'c1', 'fullName': 'Bình'},
                'property': {'id': 'p1', 'code': 'BDS-1', 'title': 'Nhà'},
                'scheduledAt': '2026-10-10T02:30:00.000Z',
                'location': null,
                'status': 'SCHEDULED',
              },
            ],
            'meta': {'page': 1, 'pageSize': 5, 'total': 1, 'totalPages': 1},
          },
        ),
      },
    );
    repository = HomeRepository(
      ApiClient(
        baseUrl: 'https://api.example.vn/api/v1',
        tokens: MemoryTokenStorage(),
        dio: Dio()..httpClientAdapter = adapter,
      ),
    );
  });

  test('số liệu từ /reports/dashboard', () async {
    final stats = await repository.stats();
    expect(stats.activeProperties, 7);
    expect(stats.newCustomers, 3);
    expect(stats.viewings, 4);
    expect(stats.wonDeals, 1);
  });

  test('lịch hẹn sắp tới: từ bây giờ, chỉ SCHEDULED, 5 lịch', () async {
    final items = await repository.upcomingAppointments(
      DateTime.utc(2026, 10, 10, 1),
    );
    final query = adapter.requests.single.options.queryParameters;
    expect(adapter.requests.single.options.path, '/appointments');
    expect(query, {
      'from': '2026-10-10T01:00:00.000Z',
      'status': 'SCHEDULED',
      'pageSize': 5,
    });
    expect(items.single.customerName, 'Bình');
    expect(items.single.scheduledAt, DateTime.utc(2026, 10, 10, 2, 30));
    expect(items.single.location, isNull);
  });
}
