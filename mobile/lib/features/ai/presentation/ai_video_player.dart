import 'package:flutter/material.dart';

import '../../../core/theme/app_tokens.dart';
import '../domain/ai_video.dart';

/// Phát video AI (TASK-150): mỗi cảnh là một ảnh phóng to dần, chữ ở dưới, thanh tiến độ theo cảnh ở trên.
/// Khung 9:16 như video ngắn trên điện thoại; chạm để tạm dừng hoặc phát tiếp.
class AiVideoPlayerScreen extends StatefulWidget {
  const AiVideoPlayerScreen({super.key, required this.video});

  final AiVideo video;

  @override
  State<AiVideoPlayerScreen> createState() => _AiVideoPlayerScreenState();
}

class _AiVideoPlayerScreenState extends State<AiVideoPlayerScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _clock = AnimationController(
    vsync: this,
    duration: widget.video.duration,
  )..forward();

  @override
  void dispose() {
    _clock.dispose();
    super.dispose();
  }

  void _toggle() {
    setState(() {
      if (_clock.isCompleted) {
        _clock.forward(from: 0);
      } else if (_clock.isAnimating) {
        _clock.stop();
      } else {
        _clock.forward();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final video = widget.video;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text('Video ${video.code}'),
      ),
      body: Center(
        child: AspectRatio(
          aspectRatio: 9 / 16,
          child: GestureDetector(
            onTap: _toggle,
            child: AnimatedBuilder(
              animation: _clock,
              builder: (context, _) {
                final (index, progress) = video.sceneAt(
                  video.duration * _clock.value,
                );
                final paused = !_clock.isAnimating;
                return Stack(
                  fit: StackFit.expand,
                  children: [
                    _SceneView(
                      key: ValueKey(index),
                      scene: video.scenes[index],
                      progress: progress,
                    ),
                    Positioned(
                      top: AppSpacing.s8,
                      left: AppSpacing.s8,
                      right: AppSpacing.s8,
                      child: Row(
                        children: [
                          for (var i = 0; i < video.scenes.length; i++)
                            Expanded(
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 2,
                                ),
                                child: LinearProgressIndicator(
                                  value: i < index
                                      ? 1
                                      : i == index
                                      ? progress
                                      : 0,
                                  color: Colors.white,
                                  backgroundColor: Colors.white24,
                                  minHeight: 3,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                    if (paused)
                      Center(
                        child: Icon(
                          _clock.isCompleted ? Icons.replay : Icons.play_arrow,
                          key: const Key('ai-video-paused'),
                          size: 64,
                          color: Colors.white70,
                          semanticLabel: _clock.isCompleted
                              ? 'Phát lại'
                              : 'Phát tiếp',
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

class _SceneView extends StatelessWidget {
  const _SceneView({super.key, required this.scene, required this.progress});

  final AiVideoScene scene;
  final double progress;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final facts = scene.kind == 'FACTS';
    return Stack(
      fit: StackFit.expand,
      children: [
        ClipRect(
          child: Transform.scale(
            scale: 1 + 0.08 * progress,
            child: Image.network(
              scene.imageUrl,
              fit: BoxFit.cover,
              errorBuilder: (context, error, stackTrace) =>
                  ColoredBox(color: theme.colorScheme.primary),
            ),
          ),
        ),
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Colors.transparent, Colors.black87],
              stops: [0.4, 1],
            ),
          ),
        ),
        Positioned(
          left: AppSpacing.s16,
          right: AppSpacing.s16,
          bottom: AppSpacing.s24,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                scene.title,
                style: theme.textTheme.headlineSmall?.copyWith(
                  color: Colors.white,
                  fontWeight: FontWeight.w600,
                ),
              ),
              for (final line in scene.lines)
                Padding(
                  padding: const EdgeInsets.only(top: AppSpacing.s4),
                  child: Text(
                    line,
                    style:
                        (facts
                                ? theme.textTheme.titleMedium
                                : theme.textTheme.bodyLarge)
                            ?.copyWith(color: Colors.white),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
