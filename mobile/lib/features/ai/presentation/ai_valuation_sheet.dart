import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/api_exception.dart';
import '../../../core/format/vn_format.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/error_retry.dart';
import '../../properties/domain/property_labels.dart';
import '../domain/ai_valuation.dart';
import 'ai_providers.dart';

/// Mở định giá AI cho một BĐS (TASK-149). Mở là gọi AI một lần; kết quả chỉ để tham khảo, không lưu vào BĐS.
Future<void> showAiValuationSheet(
  BuildContext context, {
  required String propertyId,
}) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  useRootNavigator: true,
  useSafeArea: true,
  showDragHandle: true,
  builder: (context) => AiValuationSheet(propertyId: propertyId),
);

/// "+10", "-2,5": phần trăm có dấu.
String signedPercent(double value) =>
    '${value > 0
        ? '+'
        : value < 0
        ? '-'
        : ''}${vnDecimal(value.abs())}%';

/// Câu so sánh giá chào bán với giá ước tính.
String askingComparison(AiValuation result) {
  final asking = 'Giá chào bán ${vnMoneyShort(result.askingPrice)}';
  final percent = result.askingVsEstimatePercent;
  if (percent == null || percent == 0) {
    return '$asking, bằng giá ước tính.';
  }
  return '$asking, ${percent > 0 ? 'cao' : 'thấp'} hơn ước tính ${vnDecimal(percent.abs())}%.';
}

class AiValuationSheet extends ConsumerStatefulWidget {
  const AiValuationSheet({super.key, required this.propertyId});

  final String propertyId;

  @override
  ConsumerState<AiValuationSheet> createState() => _AiValuationSheetState();
}

class _AiValuationSheetState extends ConsumerState<AiValuationSheet> {
  AiValuation? _result;
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
          .valuation(widget.propertyId);
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
          Text('AI định giá', style: theme.textTheme.titleLarge),
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
                  Text('AI đang so sánh với BĐS tương tự…'),
                ],
              ),
            )
          else ...[
            Text(
              vnMoneyShort(result.estimatePrice),
              key: const Key('ai-valuation-estimate'),
              style: theme.textTheme.headlineSmall,
            ),
            const SizedBox(height: AppSpacing.s4),
            Text(
              'Khoảng ${vnMoneyShort(result.rangeLow)} – ${vnMoneyShort(result.rangeHigh)} · '
              '${vnMoneyShort(result.estimatePricePerM2)}/m²',
              style: theme.textTheme.bodyMedium?.copyWith(color: muted),
            ),
            const SizedBox(height: AppSpacing.s8),
            Text('Độ tin cậy: ${result.confidence.label}'),
            Text(askingComparison(result)),
            const SizedBox(height: AppSpacing.s12),
            Text(result.summary),
            if (result.factors.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.s16),
              Text('Yếu tố ảnh hưởng', style: theme.textTheme.titleSmall),
              for (final factor in result.factors)
                Padding(
                  padding: const EdgeInsets.only(top: AppSpacing.s4),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(switch (factor.impact) {
                        'UP' => Icons.arrow_upward,
                        'DOWN' => Icons.arrow_downward,
                        _ => Icons.remove,
                      }, size: 18),
                      const SizedBox(width: AppSpacing.s8),
                      Expanded(child: Text('${factor.factor}: ${factor.note}')),
                    ],
                  ),
                ),
            ],
            const SizedBox(height: AppSpacing.s16),
            Text(
              'BĐS tương tự (${result.comparables.length})',
              style: theme.textTheme.titleSmall,
            ),
            for (final item in result.comparables)
              Padding(
                padding: const EdgeInsets.only(top: AppSpacing.s4),
                child: Text(
                  '${item.code} · ${vnMoneyShort(item.price)} · ${vnDecimal(item.area)} m² · '
                  '${vnMoneyShort(item.pricePerM2)}/m² · '
                  '${labelOf(propertyStatusLabels, item.status)} · '
                  '${item.sameWard ? 'Cùng phường' : 'Gần đó'}',
                ),
              ),
            const SizedBox(height: AppSpacing.s16),
            Text(
              'Giá gốc ${vnMoneyShort(result.basePrice)} từ giá/m² trung vị của BĐS tương tự; AI chỉnh '
              '${signedPercent(result.adjustmentPercent)} (tối đa ±${vnDecimal(result.maxAdjustmentPercent)}%). '
              'Kết quả chỉ để tham khảo, không thay cho thẩm định giá chính thức.',
              style: theme.textTheme.bodySmall?.copyWith(color: muted),
            ),
          ],
        ],
      ),
    );
  }
}
