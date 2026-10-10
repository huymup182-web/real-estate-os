import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/error_retry.dart';
import '../domain/ai_match.dart';
import 'ai_providers.dart';

/// Mở lời AI giải thích vì sao BĐS phù hợp với khách (TASK-135). Mở là gọi AI một lần.
Future<void> showAiMatchSheet(
  BuildContext context, {
  required String customerId,
  required String propertyId,
  required String propertyLabel,
}) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  useRootNavigator: true,
  useSafeArea: true,
  showDragHandle: true,
  builder: (context) => AiMatchSheet(
    customerId: customerId,
    propertyId: propertyId,
    propertyLabel: propertyLabel,
  ),
);

class AiMatchSheet extends ConsumerStatefulWidget {
  const AiMatchSheet({
    super.key,
    required this.customerId,
    required this.propertyId,
    required this.propertyLabel,
  });

  final String customerId;
  final String propertyId;
  final String propertyLabel;

  @override
  ConsumerState<AiMatchSheet> createState() => _AiMatchSheetState();
}

class _AiMatchSheetState extends ConsumerState<AiMatchSheet> {
  AiMatchExplanation? _result;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _result = null;
      _error = null;
    });
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      final result = await container
          .read(aiRepositoryProvider)
          .matchExplanation(widget.customerId, widget.propertyId);
      if (mounted) {
        setState(() => _result = result);
      }
    } catch (error) {
      if (mounted) {
        setState(() => _error = error);
      }
    } finally {
      // Lượt AI đã dùng (kể cả khi lỗi) thay đổi số lượt còn lại.
      container.invalidate(aiStatusProvider);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = context.appColors.mutedForeground;
    final result = _result;
    final error = _error;
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
          Text('AI giải thích', style: theme.textTheme.titleLarge),
          const SizedBox(height: AppSpacing.s4),
          Text(
            widget.propertyLabel,
            style: theme.textTheme.bodyMedium?.copyWith(color: muted),
          ),
          const SizedBox(height: AppSpacing.s16),
          if (error != null)
            error is ApiException &&
                    error.code == ErrorCodes.businessRuleViolation
                ? Text(error.message)
                : ErrorRetry(error: error, onRetry: _load)
          else if (result == null)
            const Padding(
              padding: EdgeInsets.all(AppSpacing.s16),
              child: Column(
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: AppSpacing.s12),
                  Text('AI đang đọc nhu cầu và thông tin BĐS…'),
                ],
              ),
            )
          else ...[
            Text(
              '${result.score}% phù hợp',
              key: const Key('ai-match-score'),
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: AppSpacing.s8),
            Text(result.summary),
            if (result.strengths.isNotEmpty)
              _Points(
                title: 'Điểm hợp',
                icon: Icons.check_circle_outline,
                items: result.strengths,
              ),
            if (result.concerns.isNotEmpty)
              _Points(
                title: 'Cần lưu ý',
                icon: Icons.error_outline,
                items: result.concerns,
              ),
            if (result.pitch.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.s16),
              Text('Gợi ý nói với khách', style: theme.textTheme.titleSmall),
              const SizedBox(height: AppSpacing.s4),
              SelectableText(result.pitch),
            ],
            const SizedBox(height: AppSpacing.s16),
            Text(
              'Điểm do hệ thống chấm theo nhu cầu của khách; AI chỉ viết lời giải thích, nên kiểm lại trước khi gửi khách.',
              style: theme.textTheme.bodySmall?.copyWith(color: muted),
            ),
          ],
        ],
      ),
    );
  }
}

class _Points extends StatelessWidget {
  const _Points({required this.title, required this.icon, required this.items});

  final String title;
  final IconData icon;
  final List<String> items;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: AppSpacing.s16),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleSmall),
        for (final item in items)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.s4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(icon, size: 18),
                const SizedBox(width: AppSpacing.s8),
                Expanded(child: Text(item)),
              ],
            ),
          ),
      ],
    ),
  );
}
