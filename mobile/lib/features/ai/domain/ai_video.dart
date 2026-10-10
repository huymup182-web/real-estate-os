import 'package:flutter/foundation.dart' show immutable;

/// Độ dài video AI được chọn (giây), cùng danh sách với backend.
const aiVideoDurations = [15, 30, 45, 60];
const aiVideoDefaultDuration = 30;

/// Một cảnh của video AI: ảnh nền, chữ lớn [title] và các dòng [lines], phát trong [duration].
@immutable
class AiVideoScene {
  const AiVideoScene({
    required this.kind,
    required this.imageUrl,
    required this.duration,
    required this.title,
    this.lines = const [],
  });

  factory AiVideoScene.fromJson(Map<String, dynamic> json) => AiVideoScene(
    kind: (json['kind'] as String?) ?? 'HIGHLIGHT',
    imageUrl: (json['imageUrl'] as String?) ?? '',
    duration: Duration(
      seconds: (json['durationSeconds'] as num?)?.toInt() ?? 0,
    ),
    title: (json['title'] as String?) ?? '',
    lines: [
      ...((json['lines'] as List<dynamic>?) ?? const []).whereType<String>(),
    ],
  );

  /// INTRO (mở đầu), HIGHLIGHT (điểm nổi bật), FACTS (giá, diện tích, khu vực), CTA (lời mời).
  final String kind;
  final String imageUrl;
  final Duration duration;
  final String title;
  final List<String> lines;
}

/// Video AI (`POST /properties/:id/ai-video`, TASK-150): kịch bản cảnh app tự phát. Không lưu vào BĐS.
@immutable
class AiVideo {
  const AiVideo({required this.code, required this.scenes});

  factory AiVideo.fromJson(Map<String, dynamic> json) => AiVideo(
    code:
        ((json['property'] as Map<String, dynamic>?)?['code'] as String?) ?? '',
    scenes: [
      for (final item
          in ((json['scenes'] as List<dynamic>?) ?? const [])
              .whereType<Map<String, dynamic>>())
        AiVideoScene.fromJson(item),
    ].where((scene) => scene.duration > Duration.zero).toList(),
  );

  final String code;
  final List<AiVideoScene> scenes;

  Duration get duration =>
      scenes.fold(Duration.zero, (total, scene) => total + scene.duration);

  /// Cảnh đang phát ở thời điểm [position] và tiến độ trong cảnh (0..1). Hết video thì là cảnh cuối, tiến độ 1.
  (int, double) sceneAt(Duration position) {
    var start = Duration.zero;
    for (var index = 0; index < scenes.length; index++) {
      final end = start + scenes[index].duration;
      if (position < end) {
        final progress =
            (position - start).inMicroseconds /
            scenes[index].duration.inMicroseconds;
        return (index, progress.clamp(0.0, 1.0));
      }
      start = end;
    }
    return (scenes.length - 1, 1.0);
  }
}
