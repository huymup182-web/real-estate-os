import 'package:flutter/material.dart';

import '../../../core/format/vn_format.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../domain/property_labels.dart';
import '../domain/property_summary.dart';

/// Thẻ BĐS trong danh sách: ảnh bìa, trạng thái, giá, tiêu đề, diện tích, số phòng, vị trí, mã.
class PropertyCard extends StatelessWidget {
  const PropertyCard({super.key, required this.property, this.onTap});

  final PropertySummary property;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = context.appColors.mutedForeground;
    final facts = [
      '${_area(property.area)} m²',
      if (property.bedrooms != null) '${property.bedrooms} PN',
      if (property.bathrooms != null) '${property.bathrooms} WC',
      labelOf(propertyTypeLabels, property.propertyType),
    ];

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AspectRatio(
              aspectRatio: 16 / 9,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  _Cover(url: property.coverUrl),
                  Positioned(
                    left: AppSpacing.s8,
                    top: AppSpacing.s8,
                    child: PropertyStatusBadge(status: property.status),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(AppSpacing.s12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    vnMoneyShort(property.price),
                    style: theme.textTheme.titleLarge?.copyWith(
                      color: theme.colorScheme.primary,
                    ),
                  ),
                  Text(
                    property.title,
                    style: theme.textTheme.titleMedium,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: AppSpacing.s4),
                  Text(
                    facts.join(' · '),
                    style: theme.textTheme.bodyMedium?.copyWith(color: muted),
                  ),
                  const SizedBox(height: AppSpacing.s4),
                  Row(
                    children: [
                      Icon(Icons.place_outlined, size: 16, color: muted),
                      const SizedBox(width: AppSpacing.s4),
                      Expanded(
                        child: Text(
                          property.location,
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: muted,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Text(
                        property.code,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: muted,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// 70 → "70", 70.5 → "70,5".
String _area(double area) => area == area.roundToDouble()
    ? vnNumber(area.toInt())
    : area
          .toStringAsFixed(2)
          .replaceFirst(RegExp(r'0+$'), '')
          .replaceAll('.', ',');

class _Cover extends StatelessWidget {
  const _Cover({required this.url});

  final String? url;

  @override
  Widget build(BuildContext context) {
    final placeholder = ColoredBox(
      color: Theme.of(context).colorScheme.surfaceContainerHigh,
      child: Icon(
        Icons.apartment,
        size: 48,
        color: context.appColors.mutedForeground,
      ),
    );
    if (url == null) {
      return placeholder;
    }
    return Image.network(
      url!,
      fit: BoxFit.cover,
      errorBuilder: (context, error, stackTrace) => placeholder,
      loadingBuilder: (context, child, progress) =>
          progress == null ? child : placeholder,
    );
  }
}

/// Nhãn trạng thái BĐS có màu: đang bán xanh lá, cần xác minh/hết hạn vàng, còn lại xám.
class PropertyStatusBadge extends StatelessWidget {
  const PropertyStatusBadge({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final colors = context.appColors;
    final scheme = Theme.of(context).colorScheme;
    final (background, foreground) = switch (status) {
      'AVAILABLE' => (colors.success, colors.onSuccess),
      'VERIFY_REQUIRED' || 'EXPIRED' => (colors.warning, colors.onWarning),
      'PENDING' => (colors.info, colors.onInfo),
      _ => (scheme.inverseSurface, scheme.onInverseSurface),
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
          labelOf(propertyStatusLabels, status),
          style: Theme.of(context).textTheme.labelMedium
              ?.copyWith(color: foreground),
        ),
      ),
    );
  }
}
