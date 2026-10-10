import 'package:flutter/foundation.dart' show immutable;

/// AI giải thích vì sao BĐS phù hợp với khách
/// (`POST /customers/:id/matching-properties/:propertyId/ai-explanation`, TASK-135).
@immutable
class AiMatchExplanation {
  const AiMatchExplanation({
    required this.score,
    required this.summary,
    this.strengths = const [],
    this.concerns = const [],
    this.pitch = '',
  });

  factory AiMatchExplanation.fromJson(Map<String, dynamic> json) {
    final ai = (json['ai'] as Map<String, dynamic>?) ?? const {};
    List<String> strings(Object? value) => [
      ...((value as List<dynamic>?) ?? const []).whereType<String>(),
    ];
    return AiMatchExplanation(
      score: (json['score'] as num).toInt(),
      summary: (ai['summary'] as String?) ?? '',
      strengths: strings(ai['strengths']),
      concerns: strings(ai['concerns']),
      pitch: (ai['pitch'] as String?) ?? '',
    );
  }

  /// Điểm do luật chấm (không phải AI), 0–100.
  final int score;
  final String summary;

  /// Điểm hợp với nhu cầu.
  final List<String> strengths;

  /// Điểm lệch hoặc cần hỏi thêm khách.
  final List<String> concerns;

  /// Câu gợi ý môi giới nói với khách.
  final String pitch;
}
