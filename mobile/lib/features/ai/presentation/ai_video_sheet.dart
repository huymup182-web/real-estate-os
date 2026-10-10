import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/error_retry.dart';
import '../domain/ai_video.dart';
import 'ai_providers.dart';
import 'ai_video_player.dart';

/// Mở ô tạo video AI cho một BĐS (TASK-150): chọn độ dài, AI viết chữ, app phát video từ ảnh thật.
Future<void> showAiVideoSheet(
  BuildContext context, {
  required String propertyId,
}) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  useRootNavigator: true,
  useSafeArea: true,
  showDragHandle: true,
  builder: (context) => AiVideoSheet(propertyId: propertyId),
);

class AiVideoSheet extends ConsumerStatefulWidget {
  const AiVideoSheet({super.key, required this.propertyId});

  final String propertyId;

  @override
  ConsumerState<AiVideoSheet> createState() => _AiVideoSheetState();
}

class _AiVideoSheetState extends ConsumerState<AiVideoSheet> {
  var _duration = aiVideoDefaultDuration;
  var _loading = false;
  AiVideo? _result;
  Object? _error;

  Future<void> _create() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      final result = await container
          .read(aiRepositoryProvider)
          .video(widget.propertyId, _duration);
      if (mounted) {
        setState(() {
          _loading = false;
          _result = result;
        });
        await _play(result);
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = error;
        });
      }
    } finally {
      // Lượt AI đã dùng (kể cả khi lỗi) thay đổi số lượt còn lại.
      container.invalidate(aiStatusProvider);
    }
  }

  Future<void> _play(AiVideo video) =>
      Navigator.of(context, rootNavigator: true).push<void>(
        MaterialPageRoute(
          fullscreenDialog: true,
          builder: (context) => AiVideoPlayerScreen(video: video),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = context.appColors.mutedForeground;
    final remaining = ref.watch(aiStatusProvider).value?.remaining;
    final result = _result;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.gutter,
        0,
        AppSpacing.gutter,
        AppSpacing.gutter,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('AI làm video', style: theme.textTheme.titleLarge),
          const SizedBox(height: AppSpacing.s4),
          Text(
            'Video trình chiếu ảnh của BĐS, có chữ AI viết, giá, diện tích, khu vực và lời mời xem nhà.',
            style: theme.textTheme.bodyMedium?.copyWith(color: muted),
          ),
          const SizedBox(height: AppSpacing.s12),
          Wrap(
            spacing: AppSpacing.s8,
            runSpacing: AppSpacing.s8,
            children: [
              for (final seconds in aiVideoDurations)
                ChoiceChip(
                  label: Text('$seconds giây'),
                  selected: seconds == _duration,
                  onSelected: _loading
                      ? null
                      : (_) => setState(() => _duration = seconds),
                ),
            ],
          ),
          if (remaining != null) ...[
            const SizedBox(height: AppSpacing.s8),
            Text(
              'Còn $remaining lượt AI trong 24 giờ.',
              style: theme.textTheme.bodySmall?.copyWith(color: muted),
            ),
          ],
          const SizedBox(height: AppSpacing.s12),
          FilledButton.icon(
            onPressed: _loading || remaining == 0 ? null : _create,
            icon: _loading
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.movie_creation_outlined),
            label: Text(
              _loading
                  ? 'AI đang viết kịch bản…'
                  : result == null
                  ? 'Tạo video'
                  : 'Tạo lại',
            ),
          ),
          if (result != null) ...[
            const SizedBox(height: AppSpacing.s8),
            OutlinedButton.icon(
              onPressed: () => _play(result),
              icon: const Icon(Icons.play_arrow),
              label: const Text('Xem video'),
            ),
          ],
          if (_error case final error?) ...[
            const SizedBox(height: AppSpacing.s12),
            Text(
              ErrorRetry.messageOf(error),
              style: TextStyle(color: theme.colorScheme.error),
            ),
          ],
        ],
      ),
    );
  }
}
