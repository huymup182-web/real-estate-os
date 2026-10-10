import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/error_retry.dart';
import '../domain/ai_listing.dart';
import 'ai_providers.dart';

/// Mở ô AI viết tin đăng, bài Facebook hoặc tin Zalo cho một BĐS (TASK-136, 137, 138). Tin chỉ để sao chép, không lưu
/// vào BĐS.
Future<void> showAiListingSheet(
  BuildContext context, {
  required String propertyId,
}) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  useRootNavigator: true,
  useSafeArea: true,
  showDragHandle: true,
  builder: (context) => AiListingSheet(propertyId: propertyId),
);

class AiListingSheet extends ConsumerStatefulWidget {
  const AiListingSheet({super.key, required this.propertyId});

  final String propertyId;

  @override
  ConsumerState<AiListingSheet> createState() => _AiListingSheetState();
}

class _AiListingSheetState extends ConsumerState<AiListingSheet> {
  var _style = AiListingStyle.professional;
  var _loading = false;
  AiListing? _result;
  Object? _error;

  Future<void> _write() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      final result = await container
          .read(aiRepositoryProvider)
          .listing(widget.propertyId, _style);
      if (mounted) {
        setState(() {
          _loading = false;
          _result = result;
        });
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

  Future<void> _copy(String text, String what) async {
    final messenger = ScaffoldMessenger.of(context);
    await Clipboard.setData(ClipboardData(text: text));
    messenger.showSnackBar(SnackBar(content: Text('Đã sao chép $what.')));
  }

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
          Text('AI viết tin', style: theme.textTheme.titleLarge),
          const SizedBox(height: AppSpacing.s4),
          Text(
            'AI viết từ thông số và mô tả của BĐS, không ghi số điện thoại hay số nhà. Đọc lại trước khi đăng.',
            style: theme.textTheme.bodyMedium?.copyWith(color: muted),
          ),
          const SizedBox(height: AppSpacing.s12),
          Wrap(
            spacing: AppSpacing.s8,
            runSpacing: AppSpacing.s8,
            children: [
              for (final style in AiListingStyle.values)
                ChoiceChip(
                  label: Text(style.label),
                  selected: style == _style,
                  onSelected: _loading
                      ? null
                      : (_) => setState(() => _style = style),
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
            onPressed: _loading || remaining == 0 ? null : _write,
            icon: _loading
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.auto_awesome),
            label: Text(
              _loading
                  ? 'AI đang viết…'
                  : result == null
                  ? 'Viết tin'
                  : 'Viết lại',
            ),
          ),
          if (_error case final error?) ...[
            const SizedBox(height: AppSpacing.s12),
            Text(
              ErrorRetry.messageOf(error),
              style: TextStyle(color: theme.colorScheme.error),
            ),
          ],
          if (result != null) ...[
            const SizedBox(height: AppSpacing.s16),
            _Block(
              label: result.style.titleLabel,
              text: result.title,
              onCopy: () =>
                  _copy(result.title, result.style.titleLabel.toLowerCase()),
            ),
            const SizedBox(height: AppSpacing.s12),
            _Block(
              label: result.style.bodyLabel,
              text: result.description,
              onCopy: () => _copy(
                result.description,
                result.style.bodyLabel.toLowerCase(),
              ),
            ),
            const SizedBox(height: AppSpacing.s12),
            OutlinedButton.icon(
              onPressed: () =>
                  _copy('${result.title}\n\n${result.description}', 'cả tin'),
              icon: const Icon(Icons.copy_all_outlined),
              label: const Text('Sao chép cả tin'),
            ),
          ],
        ],
      ),
    );
  }
}

class _Block extends StatelessWidget {
  const _Block({required this.label, required this.text, required this.onCopy});

  final String label;
  final String text;
  final VoidCallback onCopy;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Row(
        children: [
          Expanded(
            child: Text(label, style: Theme.of(context).textTheme.titleSmall),
          ),
          IconButton(
            tooltip: 'Sao chép ${label.toLowerCase()}',
            icon: const Icon(Icons.copy_outlined, size: 20),
            onPressed: onCopy,
          ),
        ],
      ),
      SelectableText(text),
    ],
  );
}
