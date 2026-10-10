import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/format/vn_format.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/error_retry.dart';
import '../../properties/domain/property_labels.dart' show labelOf;
import '../domain/customer_labels.dart';
import 'customer_list_controller.dart';
import 'pipeline_controller.dart';

/// Pipeline khách hàng: số khách xem được ở từng bước, thanh dài theo bước đông nhất. Chạm một bước để về danh
/// sách khách chỉ lọc bước đó. Kéo xuống để tải lại.
class PipelineScreen extends ConsumerWidget {
  const PipelineScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pipeline = ref.watch(customerPipelineProvider);

    Future<void> refresh() async {
      ref.invalidate(customerPipelineProvider);
      try {
        await ref.read(customerPipelineProvider.future);
      } on Object catch (error) {
        if (context.mounted) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(ErrorRetry.messageOf(error))));
        }
      }
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Pipeline khách hàng')),
      body: switch (pipeline) {
        AsyncValue(:final value?) => RefreshIndicator(
          onRefresh: refresh,
          child: _Stages(stages: value),
        ),
        AsyncError(:final error) => Center(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.gutter),
            child: ErrorRetry(
              error: error,
              onRetry: () => ref.invalidate(customerPipelineProvider),
            ),
          ),
        ),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }
}

class _Stages extends ConsumerWidget {
  const _Stages({required this.stages});

  final List<({String status, int count})> stages;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final muted = context.appColors.mutedForeground;
    final total = stages.fold(0, (sum, stage) => sum + stage.count);
    final most = stages.fold(
      0,
      (max, stage) => stage.count > max ? stage.count : max,
    );
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.s8),
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.gutter,
            vertical: AppSpacing.s8,
          ),
          child: Text(
            '${vnNumber(total)} khách · Chạm một bước để xem danh sách',
            style: theme.textTheme.bodyMedium?.copyWith(color: muted),
          ),
        ),
        for (final stage in stages)
          InkWell(
            onTap: () {
              ref.read(customerQueryProvider.notifier).showOnly(stage.status);
              Navigator.of(context).pop();
            },
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.gutter,
                vertical: AppSpacing.s12,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          labelOf(customerStatusLabels, stage.status),
                          style: theme.textTheme.titleSmall,
                        ),
                      ),
                      Text(
                        vnNumber(stage.count),
                        style: theme.textTheme.titleSmall,
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.s4),
                  ClipRRect(
                    borderRadius: const BorderRadius.all(AppRadius.full),
                    child: LinearProgressIndicator(
                      value: most == 0 ? 0 : stage.count / most,
                      minHeight: 8,
                      semanticsLabel:
                          '${labelOf(customerStatusLabels, stage.status)}: ${stage.count} khách',
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}
