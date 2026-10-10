import 'package:flutter/foundation.dart' show immutable;

/// BĐS nghi trùng (TASK-144). Người xem không được xem BĐS đó thì chỉ có [code], [propertyId] null.
@immutable
class DuplicateMatch {
  const DuplicateMatch({
    required this.code,
    required this.similarity,
    this.reasons = const [],
    this.propertyId,
    this.title,
  });

  factory DuplicateMatch.fromJson(Map<String, dynamic> json) {
    final property = json['property'] as Map<String, dynamic>?;
    return DuplicateMatch(
      code: json['code'] as String,
      similarity: (json['similarity'] as num).toInt(),
      reasons: [
        for (final reason in (json['reasons'] as List<dynamic>? ?? const []))
          reason as String,
      ],
      propertyId: property?['id'] as String?,
      title: property?['title'] as String?,
    );
  }

  final String code;

  /// 0–100.
  final int similarity;
  final List<String> reasons;
  final String? propertyId;
  final String? title;
}

/// Kết quả kiểm trùng: các BĐS có độ giống từ [threshold]% trở lên, giống nhất trước.
@immutable
class DuplicateReport {
  const DuplicateReport({required this.threshold, this.matches = const []});

  factory DuplicateReport.fromJson(Map<String, dynamic> json) =>
      DuplicateReport(
        threshold: (json['threshold'] as num).toInt(),
        matches: [
          for (final item in (json['matches'] as List<dynamic>? ?? const []))
            DuplicateMatch.fromJson(item as Map<String, dynamic>),
        ],
      );

  final int threshold;
  final List<DuplicateMatch> matches;
}
