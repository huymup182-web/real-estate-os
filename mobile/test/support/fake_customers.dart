import 'package:real_estate_os/core/network/api_response.dart';
import 'package:real_estate_os/core/network/page.dart';
import 'package:real_estate_os/features/customers/data/customers_repository.dart';
import 'package:real_estate_os/features/customers/domain/customer_query.dart';
import 'package:real_estate_os/features/customers/domain/customer_summary.dart';

/// CustomersRepository giả: [onList] trả từng trang (mặc định rỗng). Điều kiện của lần gọi đang chạy là
/// `listedQueries.last`.
class FakeCustomersRepository implements CustomersRepository {
  FakeCustomersRepository([
    Future<Page<CustomerSummary>> Function(int page)? onList,
  ]) : onList = onList ?? ((_) async => customerPage(const [], total: 0));

  Future<Page<CustomerSummary>> Function(int page) onList;
  final listedPages = <int>[];
  final listedQueries = <CustomerQuery>[];

  @override
  Future<Page<CustomerSummary>> list({
    required int page,
    CustomerQuery query = const CustomerQuery(),
  }) {
    listedPages.add(page);
    listedQueries.add(query);
    return onList(page);
  }
}

Page<CustomerSummary> customerPage(
  List<CustomerSummary> items, {
  int page = 1,
  int pageSize = 20,
  required int total,
}) => Page(
  items: items,
  meta: PageMeta(
    page: page,
    pageSize: pageSize,
    total: total,
    totalPages: (total / pageSize).ceil(),
  ),
);

CustomerSummary customer(int n, {String status = 'NEW'}) => CustomerSummary(
  id: 'c$n',
  fullName: 'Khách số $n',
  phone: '+8490123456${n % 10}',
  status: status,
  createdAt: DateTime.utc(2026, 10, 8, 20),
  purpose: 'LIVING',
  purchaseTimeline: 'WITHIN_3_MONTHS',
  source: 'ZALO',
);
