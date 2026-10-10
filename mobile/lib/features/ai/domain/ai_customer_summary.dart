import 'package:flutter/foundation.dart' show immutable;

/// AI tóm tắt khách (`POST /customers/:id/ai-summary`, TASK-140).
@immutable
class AiCustomerSummary {
  const AiCustomerSummary({
    required this.summary,
    this.keyPoints = const [],
    this.openQuestions = const [],
    this.activityCount = 0,
  });

  factory AiCustomerSummary.fromJson(Map<String, dynamic> json) {
    List<String> strings(Object? value) => [
      ...((value as List<dynamic>?) ?? const []).whereType<String>(),
    ];
    return AiCustomerSummary(
      summary: (json['summary'] as String?) ?? '',
      keyPoints: strings(json['keyPoints']),
      openQuestions: strings(json['openQuestions']),
      activityCount: (json['activityCount'] as num?)?.toInt() ?? 0,
    );
  }

  final String summary;

  /// Ý chính về nhu cầu, phản hồi của khách.
  final List<String> keyPoints;

  /// Thông tin còn thiếu nên hỏi khách.
  final List<String> openQuestions;

  /// Số hoạt động gần nhất AI đã đọc.
  final int activityCount;
}
