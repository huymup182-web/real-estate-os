import 'api_response.dart';

/// Một trang của danh sách phân trang.
class Page<T> {
  const Page({required this.items, required this.meta});

  factory Page.from(
    ApiResponse response,
    T Function(Map<String, dynamic> json) fromJson,
  ) => Page(
    items: response.list.map(fromJson).toList(),
    meta:
        response.meta ??
        PageMeta(
          page: 1,
          pageSize: response.list.length,
          total: response.list.length,
          totalPages: 1,
        ),
  );

  final List<T> items;
  final PageMeta meta;
}
