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
}
