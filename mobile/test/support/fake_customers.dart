import 'package:real_estate_os/core/network/api_response.dart';
import 'package:real_estate_os/core/network/page.dart';
import 'package:real_estate_os/features/customers/data/customers_repository.dart';
import 'package:real_estate_os/features/customers/domain/customer_detail.dart';
import 'package:real_estate_os/features/customers/domain/customer_query.dart';
import 'package:real_estate_os/features/customers/domain/customer_summary.dart';
import 'package:real_estate_os/features/customers/domain/property_match.dart';

/// CustomersRepository giả: [onList] trả từng trang (mặc định rỗng). Điều kiện của lần gọi đang chạy là
/// `listedQueries.last`.
class FakeCustomersRepository implements CustomersRepository {
  FakeCustomersRepository([
    Future<Page<CustomerSummary>> Function(int page)? onList,
  ]) : onList = onList ?? ((_) async => customerPage(const [], total: 0));

  Future<Page<CustomerSummary>> Function(int page) onList;
  Future<CustomerDetail> Function(String id) onDetail = (id) async =>
      customerDetail(id);
  Future<List<CustomerPreference>> Function(String id) onPreferences = (
    id,
  ) async => const [];
  Future<Page<CustomerActivity>> Function(int page) onActivities = (_) async =>
      const Page(
        items: [],
        meta: PageMeta(page: 1, pageSize: 20, total: 0, totalPages: 0),
      );
  Future<String> Function(String userId) onUserName = (userId) async =>
      'Môi giới $userId';
  Future<List<({String status, int count})>> Function() onPipeline = () async =>
      const [
        (status: 'NEW', count: 4),
        (status: 'CONTACTED', count: 2),
        (status: 'QUALIFIED', count: 0),
        (status: 'VIEWING', count: 1),
        (status: 'NEGOTIATING', count: 0),
        (status: 'DEPOSIT', count: 0),
        (status: 'WON', count: 3),
        (status: 'LOST', count: 1),
      ];
  Future<CustomerDetail> Function(String id, String status, String? reason)
  onChangeStatus = (id, status, reason) async =>
      customerDetail(id, status: status, lostReason: reason);
  Future<List<PropertyMatch>> Function(String id) onMatches = (id) async =>
      const [];
  final matchCalls = <String>[];
  final statusChanges =
      <({String id, String status, String? lostReason, DateTime expected})>[];
  final detailCalls = <String>[];
  final activityPages = <int>[];
  final userNameCalls = <String>[];
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

  @override
  Future<CustomerDetail> detail(String id) {
    detailCalls.add(id);
    return onDetail(id);
  }

  @override
  Future<List<CustomerPreference>> preferences(String id) => onPreferences(id);

  @override
  Future<Page<CustomerActivity>> activities(String id, {required int page}) {
    activityPages.add(page);
    return onActivities(page);
  }

  @override
  Future<List<PropertyMatch>> matchingProperties(
    String id, {
    int limit = CustomersRepository.matchLimit,
  }) {
    matchCalls.add(id);
    return onMatches(id);
  }

  @override
  Future<List<({String status, int count})>> pipeline() => onPipeline();

  @override
  Future<CustomerDetail> changeStatus(
    String id, {
    required String status,
    String? lostReason,
    required DateTime expectedUpdatedAt,
  }) {
    statusChanges.add((
      id: id,
      status: status,
      lostReason: lostReason,
      expected: expectedUpdatedAt,
    ));
    return onChangeStatus(id, status, lostReason);
  }

  @override
  Future<String> userName(String userId) {
    userNameCalls.add(userId);
    return onUserName(userId);
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

CustomerDetail customerDetail(
  String id, {
  String status = 'VIEWING',
  String? agentId,
  String? lostReason,
  String? notes = 'Thích nhà gần biển.',
}) => CustomerDetail(
  id: id,
  fullName: 'Trần Thị Bình',
  phone: '+84901234567',
  status: status,
  email: 'binh@example.vn',
  purpose: 'INVESTMENT',
  purchaseTimeline: 'IMMEDIATE',
  source: 'REFERRAL',
  agentId: agentId,
  lostReason: lostReason,
  notes: notes,
  createdAt: DateTime.utc(2026, 10, 1, 3),
  updatedAt: DateTime.utc(2026, 10, 8, 3),
);

CustomerActivity activity(int n, {String type = 'CALL'}) => CustomerActivity(
  id: 'a$n',
  type: type,
  occurredAt: DateTime.utc(2026, 10, 8, 1, 30),
  content: 'Hoạt động số $n',
  userName: 'Nguyễn Văn An',
);

/// Trang [page] của timeline có [total] hoạt động, 20 dòng mỗi trang.
Page<CustomerActivity> activityPage(int page, {required int total}) {
  final from = (page - 1) * 20;
  final count = (total - from).clamp(0, 20);
  return Page(
    items: [for (var i = 1; i <= count; i++) activity(from + i)],
    meta: PageMeta(
      page: page,
      pageSize: 20,
      total: total,
      totalPages: (total / 20).ceil(),
    ),
  );
}
