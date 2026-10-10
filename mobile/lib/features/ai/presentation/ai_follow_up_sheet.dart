import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/error_retry.dart';
import '../../customers/presentation/customer_card.dart';
import '../../properties/domain/property_labels.dart' show labelOf;
import '../domain/ai_follow_up.dart';
import 'ai_providers.dart';

/// Mở danh sách khách cần chăm sóc và gợi ý của AI (TASK-141). Mở là gọi một lần.
Future<void> showAiFollowUpSheet(BuildContext context) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useRootNavigator: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (context) => const AiFollowUpSheet(),
    );

class AiFollowUpSheet extends ConsumerStatefulWidget {
  const AiFollowUpSheet({super.key});

  @override
  ConsumerState<AiFollowUpSheet> createState() => _AiFollowUpSheetState();
}

class _AiFollowUpSheetState extends ConsumerState<AiFollowUpSheet> {
  AiFollowUps? _result;
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
      final result = await container.read(aiRepositoryProvider).followUps();
      if (mounted) {
        setState(() => _result = result);
      }
    } catch (error) {
      if (mounted) {
        setState(() => _error = error);
      }
    } finally {
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
          Text('Khách cần chăm sóc', style: theme.textTheme.titleLarge),
          const SizedBox(height: AppSpacing.s4),
          if (result != null)
            Text(
              'Khách chưa chốt, quá ${result.thresholdDays} ngày chưa có hoạt động. Khách ở bước gần chốt đứng trước; AI gợi ý việc nên làm.',
              style: theme.textTheme.bodyMedium?.copyWith(color: muted),
            ),
          const SizedBox(height: AppSpacing.s12),
          if (error != null)
            ErrorRetry(error: error, onRetry: _load)
          else if (result == null)
            const Padding(
              padding: EdgeInsets.all(AppSpacing.s16),
              child: Column(
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: AppSpacing.s12),
                  Text('AI đang xem các khách lâu chưa chăm sóc…'),
                ],
              ),
            )
          else if (result.items.isEmpty)
            Text(
              'Không có khách nào quá ${result.thresholdDays} ngày chưa chăm sóc.',
              style: TextStyle(color: muted),
            )
          else
            for (final item in result.items) _FollowUpTile(item: item),
        ],
      ),
    );
  }
}

class _FollowUpTile extends StatelessWidget {
  const _FollowUpTile({required this.item});

  final AiFollowUpItem item;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = context.appColors.mutedForeground;
    final action = item.action;
    final message = item.message;
    return Padding(
      key: Key('follow-up-${item.customerId}'),
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.s8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            onTap: () {
              Navigator.of(context).pop();
              GoRouter.of(context)
                  .push(AppRoutes.customerDetail(item.customerId));
            },
            child: Wrap(
              spacing: AppSpacing.s8,
              runSpacing: AppSpacing.s4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(item.fullName, style: theme.textTheme.titleSmall),
                CustomerStatusBadge(status: item.status),
                Text(
                  '${item.daysSinceContact} ngày chưa chăm sóc',
                  style: theme.textTheme.bodySmall?.copyWith(color: muted),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.s4),
          if (action == null)
            Text(
              'AI chưa có gợi ý cho khách này.',
              style: TextStyle(color: muted),
            )
          else ...[
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: '${labelOf(followUpActionLabels, action)}: ',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  TextSpan(text: item.reason ?? ''),
                ],
              ),
            ),
            if (message != null)
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '"$message"',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Sao chép câu nhắn',
                    icon: const Icon(Icons.copy_outlined, size: 20),
                    onPressed: () async {
                      final messenger = ScaffoldMessenger.of(context);
                      await Clipboard.setData(ClipboardData(text: message));
                      messenger.showSnackBar(
                        const SnackBar(content: Text('Đã sao chép câu nhắn.')),
                      );
                    },
                  ),
                ],
              ),
          ],
        ],
      ),
    );
  }
}
