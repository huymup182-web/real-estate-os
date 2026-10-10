import 'package:flutter/material.dart';

import '../../../core/format/vn_format.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../properties/domain/property_labels.dart' show labelOf;
import '../domain/customer_labels.dart';
import '../domain/customer_summary.dart';

/// Thẻ khách trong danh sách: tên, số điện thoại, bước pipeline, mục đích, thời gian mua, nguồn, ngày tạo.
class CustomerCard extends StatelessWidget {
  const CustomerCard({super.key, required this.customer, this.onTap});

  final CustomerSummary customer;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = context.appColors.mutedForeground;
    final facts = [
      if (customer.purpose case final purpose?)
        labelOf(customerPurposeLabels, purpose),
      if (customer.purchaseTimeline case final timeline?)
        labelOf(purchaseTimelineLabels, timeline),
      if (customer.source case final source?)
        labelOf(customerSourceLabels, source),
    ];
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.s12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          customer.fullName,
                          style: theme.textTheme.titleMedium,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        Text(
                          vnPhone(customer.phone),
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: AppSpacing.s8),
                  CustomerStatusBadge(status: customer.status),
                ],
              ),
              if (facts.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.s4),
                Text(facts.join(' · '), style: theme.textTheme.bodyMedium),
              ],
              const SizedBox(height: AppSpacing.s4),
              Text(
                'Tạo ${vnDate(customer.createdAt)}',
                style: theme.textTheme.bodySmall?.copyWith(color: muted),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Nhãn bước pipeline có màu: chốt xanh lá, đặt cọc/thương lượng vàng, mất khách xám, còn lại xanh dương.
class CustomerStatusBadge extends StatelessWidget {
  const CustomerStatusBadge({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final scheme = Theme.of(context).colorScheme;
    final (background, foreground) = switch (status) {
      'WON' => (colors.success, colors.onSuccess),
      'DEPOSIT' || 'NEGOTIATING' => (colors.warning, colors.onWarning),
      'LOST' => (scheme.inverseSurface, scheme.onInverseSurface),
      _ => (colors.info, colors.onInfo),
    };
    return DecoratedBox(
      decoration: BoxDecoration(
        color: background,
        borderRadius: const BorderRadius.all(AppRadius.full),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.s8,
          vertical: AppSpacing.s2,
        ),
        child: Text(
          labelOf(customerStatusLabels, status),
          style: Theme.of(context).textTheme.labelMedium
              ?.copyWith(color: foreground),
        ),
      ),
    );
  }
}
