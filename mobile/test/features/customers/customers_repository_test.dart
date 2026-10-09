import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/network/api_client.dart';
import 'package:real_estate_os/core/storage/token_storage.dart';
import 'package:real_estate_os/features/customers/data/customers_repository.dart';
import 'package:real_estate_os/features/customers/domain/customer_query.dart';

import '../../support/fake_adapter.dart';

void main() {
  late FakeAdapter adapter;
  late CustomersRepository repository;

  setUp(() {
    adapter = FakeAdapter(
      (options) => (
        200,
        {
          'success': true,
          'message': null,
          'data': [
            {
              'id': 'c1',
              'fullName': 'Trần Thị Bình',
              'phone': '+84901234567',
              'email': null,
              'purpose': 'INVESTMENT',
              'purchaseTimeline': null,
              'source': 'ZALO',
              'agentId': 'u1',
              'status': 'VIEWING',
              'lostReason': null,
              'notes': 'Ghi chú',
              'createdBy': 'u1',
              'updatedBy': null,
              'createdAt': '2026-10-08T03:00:00.000Z',
              'updatedAt': '2026-10-08T03:00:00.000Z',
            },
          ],
          'meta': {'page': 2, 'pageSize': 20, 'total': 21, 'totalPages': 2},
        },
      ),
    );
    repository = CustomersRepository(
      ApiClient(
        baseUrl: 'https://api.example.vn/api/v1',
        tokens: MemoryTokenStorage(),
        dio: Dio()..httpClientAdapter = adapter,
      ),
    );
  });

  test('GET /customers theo trang, đọc thẻ khách và meta', () async {
    final page = await repository.list(page: 2);
    final request = adapter.requests.single.options;
    expect(request.path, '/customers');
    expect(request.queryParameters, {'page': 2, 'pageSize': 20});
    expect(page.meta.total, 21);
    final customer = page.items.single;
    expect(customer.fullName, 'Trần Thị Bình');
    expect(customer.phone, '+84901234567');
    expect(customer.status, 'VIEWING');
    expect(customer.purpose, 'INVESTMENT');
    expect(customer.purchaseTimeline, isNull);
    expect(customer.createdAt, DateTime.utc(2026, 10, 8, 3));
  });

  test('từ khoá gửi q; bước gửi status theo thứ tự pipeline', () async {
    await repository.list(
      page: 1,
      query: const CustomerQuery().withKeyword('  0901  234 ').withStatuses({
        'WON',
        'NEW',
        'VIEWING',
      }),
    );
    expect(adapter.requests.single.options.queryParameters, {
      'page': 1,
      'pageSize': 20,
      'q': '0901 234',
      'status': 'NEW,VIEWING,WON',
    });
  });

  test('từ khoá tối đa 100 ký tự; điều kiện so sánh không theo thứ tự', () {
    expect(
      const CustomerQuery().withKeyword('a' * 150).keyword,
      hasLength(100),
    );
    expect(
      const CustomerQuery(statuses: {'NEW', 'WON'}),
      const CustomerQuery(statuses: {'WON', 'NEW'}),
    );
    expect(const CustomerQuery().isEmpty, isTrue);
    expect(const CustomerQuery(statuses: {'NEW'}).isEmpty, isFalse);
  });

  test('chi tiết, nhu cầu, timeline, tên môi giới', () async {
    final api = FakeAdapter((options) {
      final path = options.path;
      final Object data = switch (path) {
        '/customers/c1' => {
          'id': 'c1',
          'fullName': 'Trần Thị Bình',
          'phone': '+84901234567',
          'email': null,
          'purpose': null,
          'purchaseTimeline': null,
          'source': null,
          'agentId': 'u2',
          'status': 'LOST',
          'lostReason': 'Mua chỗ khác',
          'notes': null,
          'createdBy': 'u1',
          'updatedBy': 'u1',
          'createdAt': '2026-10-01T03:00:00.000Z',
          'updatedAt': '2026-10-08T03:00:00.000Z',
        },
        '/customers/c1/preferences' => [
          {
            'id': 'p1',
            'customerId': 'c1',
            'transactionType': 'SALE',
            'propertyTypes': ['APARTMENT'],
            'budgetMin': 2000000000,
            'budgetMax': null,
            'areaMin': 60.5,
            'areaMax': null,
            'bedroomsMin': 2,
            'provinceIds': ['kh'],
            'districtIds': null,
            'wardIds': null,
            'directions': null,
            'legalStatuses': null,
            'minRoadAccess': null,
            'isActive': false,
            'createdAt': '2026-10-01T03:00:00.000Z',
            'updatedAt': '2026-10-01T03:00:00.000Z',
          },
        ],
        '/customers/c1/activities' => [
          {
            'id': 'a1',
            'type': 'STATUS_CHANGE',
            'content': null,
            'propertyIds': null,
            'metadata': {'from': 'NEW', 'to': 'LOST'},
            'user': {'id': 'u1', 'fullName': 'Nguyễn Văn An'},
            'occurredAt': '2026-10-08T03:00:00.000Z',
            'createdAt': '2026-10-08T03:00:00.000Z',
          },
        ],
        _ => {'id': 'u2', 'fullName': 'Lê Văn Cường'},
      };
      return (
        200,
        {
          'success': true,
          'message': null,
          'data': data,
          if (path.endsWith('/activities'))
            'meta': {'page': 2, 'pageSize': 20, 'total': 21, 'totalPages': 2},
        },
      );
    });
    final repository = CustomersRepository(
      ApiClient(
        baseUrl: 'https://api.example.vn/api/v1',
        tokens: MemoryTokenStorage(),
        dio: Dio()..httpClientAdapter = api,
      ),
    );

    final detail = await repository.detail('c1');
    expect(detail.status, 'LOST');
    expect(detail.lostReason, 'Mua chỗ khác');
    expect(detail.agentId, 'u2');
    expect(detail.purpose, isNull);
    expect(detail.updatedAt, DateTime.utc(2026, 10, 8, 3));

    final [preference] = await repository.preferences('c1');
    expect(preference.transactionType, 'SALE');
    expect(preference.propertyTypes, ['APARTMENT']);
    expect(preference.budgetMin, 2000000000);
    expect(preference.areaMin, 60.5);
    expect(preference.provinceIds, ['kh']);
    expect(preference.isActive, isFalse);

    final timeline = await repository.activities('c1', page: 2);
    expect(timeline.meta.hasNext, isFalse);
    expect(timeline.items.single.userName, 'Nguyễn Văn An');
    expect(timeline.items.single.content, isNull);

    expect(await repository.userName('u2'), 'Lê Văn Cường');
    expect(
      [for (final r in api.requests) r.options.path],
      [
        '/customers/c1',
        '/customers/c1/preferences',
        '/customers/c1/activities',
        '/users/u2',
      ],
    );
    expect(api.requests[2].options.queryParameters, {
      'page': 2,
      'pageSize': 20,
    });
  });
}
