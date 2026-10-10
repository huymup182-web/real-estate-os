import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/error_retry.dart';
import '../domain/ai_customer_summary.dart';
import 'ai_points.dart';
import 'ai_providers.dart';

/// Mở tóm tắt khách do AI viết (TASK-140). Mở là gọi AI một lần.
Future<void> showAiCustomerSummarySheet(
  BuildContext context, {
  required String customerId,
}) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  useRootNavigator: true,
  useSafeArea: true,
  showDragHandle: true,
  builder: (context) => AiCustomerSummarySheet(customerId: customerId),
);

class AiCustomerSummarySheet extends ConsumerStatefulWidget {
  const AiCustomerSummarySheet({super.key, required this.customerId});

  final String customerId;

  @override
  ConsumerState<AiCustomerSummarySheet> createState() =>
      _AiCustomerSummarySheetState();
}

class _AiCustomerSummarySheetState
    extends ConsumerState<AiCustomerSummarySheet> {
  AiCustomerSummary? _result;
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
          .customerSummary(widget.customerId);
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
          Text('AI tóm tắt khách', style: theme.textTheme.titleLarge),
          const SizedBox(height: AppSpacing.s16),
          if (error != null)
            ErrorRetry(error: error, onRetry: _load)
          else if (result == null)
            const Padding(
              padding: EdgeInsets.all(AppSpacing.s16),
              child: Column(
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: AppSpacing.s12),
                  Text('AI đang đọc nhu cầu và lịch sử chăm sóc…'),
                ],
              ),
            )
          else ...[
            Text(result.summary),
            if (result.keyPoints.isNotEmpty)
              AiPoints(
                title: 'Ý chính',
                icon: Icons.check_circle_outline,
                items: result.keyPoints,
              ),
            if (result.openQuestions.isNotEmpty)
              AiPoints(
                title: 'Nên hỏi thêm',
                icon: Icons.help_outline,
                items: result.openQuestions,
              ),
            const SizedBox(height: AppSpacing.s16),
            Text(
              'AI đọc nhu cầu, ghi chú và ${result.activityCount} hoạt động gần nhất của khách. Nên kiểm lại với lịch sử bên dưới.',
              style: theme.textTheme.bodySmall?.copyWith(color: muted),
            ),
          ],
        ],
      ),
    );
  }
}
