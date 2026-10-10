import 'package:flutter/foundation.dart' show immutable;

import '../../properties/domain/property_query.dart';

/// Trạng thái AI của người đang đăng nhập (`GET /ai/status`, TASK-133).
@immutable
class AiStatus {
  const AiStatus({required this.enabled, this.dailyLimit, this.remaining});

  factory AiStatus.fromJson(Map<String, dynamic> json) => AiStatus(
    enabled: json['enabled'] == true,
    dailyLimit: (json['dailyLimit'] as num?)?.toInt(),
    remaining: (json['remaining'] as num?)?.toInt(),
  );

  final bool enabled;

  /// Số lượt AI tối đa trong 24 giờ; `null` khi AI tắt.
  final int? dailyLimit;
  final int? remaining;
}

/// Kết quả tìm BĐS bằng câu tự nhiên (`POST /ai/property-search`, TASK-134).
@immutable
class AiPropertySearch {
  const AiPropertySearch({
    required this.query,
    required this.explanation,
    this.unresolved = const [],
  });

  factory AiPropertySearch.fromJson(Map<String, dynamic> json) =>
      AiPropertySearch(
        query: PropertyQuery.fromFilters(
          (json['filters'] as Map<String, dynamic>?) ?? const {},
        ),
        explanation: (json['explanation'] as String?) ?? '',
        unresolved: [
          ...((json['unresolved'] as List<dynamic>?) ?? const [])
              .whereType<String>(),
        ],
      );

  /// Điều kiện tìm AI rút ra; app tìm bằng `GET /properties` như bộ lọc thường.
  final PropertyQuery query;

  /// Câu AI nói lại các điều kiện đã hiểu.
  final String explanation;

  /// Khu vực AI nêu mà không có trong danh mục, nên chưa lọc theo.
  final List<String> unresolved;
}
