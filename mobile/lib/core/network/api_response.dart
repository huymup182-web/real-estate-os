/// Thông tin phân trang trong `meta` của danh sách.
class PageMeta {
  const PageMeta({
    required this.page,
    required this.pageSize,
    required this.total,
    required this.totalPages,
  });

  factory PageMeta.fromJson(Map<String, dynamic> json) => PageMeta(
    page: json['page'] as int,
    pageSize: json['pageSize'] as int,
    total: json['total'] as int,
    totalPages: json['totalPages'] as int,
  );

  final int page;
  final int pageSize;
  final int total;
  final int totalPages;

  bool get hasNext => page < totalPages;
}

/// Body thành công `{success: true, data, meta?}`; [data] là JSON thô, tầng data của feature tự đổi sang model.
class ApiResponse {
  const ApiResponse({required this.data, this.meta});

  final Object? data;
  final PageMeta? meta;

  /// `data` là một object.
  Map<String, dynamic> get object => data! as Map<String, dynamic>;

  /// `data` là danh sách object.
  List<Map<String, dynamic>> get list =>
      (data! as List<dynamic>).cast<Map<String, dynamic>>();
}
