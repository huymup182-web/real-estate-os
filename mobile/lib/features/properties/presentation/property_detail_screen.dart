import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/error/api_exception.dart';
import '../../../core/format/vn_format.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/error_retry.dart';
import '../domain/property_detail.dart';
import '../domain/property_labels.dart';
import 'favorite_button.dart';
import 'property_card.dart';
import 'property_detail_providers.dart';
import 'property_gallery.dart';

/// Chi tiết BĐS: ảnh, giá, địa chỉ, thông số, mô tả, chủ nhà (nếu được xem), xác minh. Thanh tiêu đề có nút
/// yêu thích; sửa được (`canEdit`) thì có thêm nút quản lý ảnh và nút sửa.
class PropertyDetailScreen extends ConsumerWidget {
  const PropertyDetailScreen({super.key, required this.propertyId});

  final String propertyId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(propertyDetailProvider(propertyId));

    // Kéo xuống tải lại: đang có dữ liệu thì giữ, lỗi thì báo snackbar.
    Future<void> refresh() async {
      ref.invalidate(propertyImagesProvider(propertyId));
      ref.invalidate(propertyDetailProvider(propertyId));
      try {
        await ref.read(propertyDetailProvider(propertyId).future);
      } on Object catch (error) {
        if (context.mounted) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(ErrorRetry.messageOf(error))));
        }
      }
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(detail.value?.code ?? 'Chi tiết BĐS'),
        actions: [
          if (detail.value case final value?)
            FavoriteButton(propertyId: propertyId, loaded: value.isFavorite),
          if (detail.value?.canEdit ?? false) ...[
            IconButton(
              tooltip: 'Quản lý ảnh',
              icon: const Icon(Icons.photo_library_outlined),
              onPressed: () =>
                  context.push(AppRoutes.propertyImages(propertyId)),
            ),
            IconButton(
              tooltip: 'Sửa BĐS',
              icon: const Icon(Icons.edit_outlined),
              onPressed: () => context.push(AppRoutes.propertyEdit(propertyId)),
            ),
          ],
        ],
      ),
      body: switch (detail) {
        AsyncValue(:final value?) => RefreshIndicator(
          onRefresh: refresh,
          child: _Body(property: value),
        ),
        AsyncError(:final error) => Center(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.gutter),
            child: error is ApiException && error.code == ErrorCodes.notFound
                ? Text(
                    'Không tìm thấy BĐS, hoặc bạn không có quyền xem BĐS này.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyLarge,
                  )
                : ErrorRetry(
                    error: error,
                    onRetry: () =>
                        ref.invalidate(propertyDetailProvider(propertyId)),
                  ),
          ),
        ),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.property});

  final PropertyDetail property;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = context.appColors.mutedForeground;
    final facts = <(String, String)>[
      ('Loại', labelOf(propertyTypeLabels, property.propertyType)),
      ('Diện tích', '${vnDecimal(property.area)} m²'),
      if (property.bedrooms case final bedrooms?) ('Phòng ngủ', '$bedrooms'),
      if (property.bathrooms case final bathrooms?) ('WC', '$bathrooms'),
      if (property.floors case final floors?) ('Số tầng', '$floors'),
      if (property.direction case final direction?)
        ('Hướng', labelOf(directionLabels, direction)),
      if (property.roadWidth case final width?)
        ('Đường rộng', '${vnDecimal(width)} m'),
      if (property.roadAccess case final access?)
        ('Đường vào', labelOf(roadAccessLabels, access)),
      if (property.legalStatus case final legal?)
        ('Pháp lý', labelOf(legalStatusLabels, legal)),
    ];

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(bottom: AppSpacing.s24),
      children: [
        PropertyGallery(propertyId: property.id),
        Padding(
          padding: const EdgeInsets.all(AppSpacing.gutter),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: AppSpacing.s8,
                runSpacing: AppSpacing.s4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  PropertyStatusBadge(status: property.status),
                  Text(
                    property.code,
                    style: theme.textTheme.bodySmall?.copyWith(color: muted),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.s8),
              Text(
                vnMoneyShort(property.price),
                style: theme.textTheme.headlineSmall?.copyWith(
                  color: theme.colorScheme.primary,
                ),
              ),
              Text(
                [
                  '${vnNumber(property.price)} đ',
                  if (property.pricePerM2 case final perM2?)
                    '${vnMoneyShort(perM2)}/m²',
                ].join(' · '),
                style: theme.textTheme.bodyMedium?.copyWith(color: muted),
              ),
              const SizedBox(height: AppSpacing.s8),
              Text(property.title, style: theme.textTheme.titleLarge),
              if (property.address.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.s8),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.place_outlined, size: 20, color: muted),
                    const SizedBox(width: AppSpacing.s4),
                    Expanded(child: Text(property.address)),
                  ],
                ),
              ],
            ],
          ),
        ),
        _Section(
          title: 'Thông tin',
          child: Column(
            children: [
              for (final (label, value) in facts)
                _InfoRow(label: label, value: value),
            ],
          ),
        ),
        if (property.description case final description?
            when description.trim().isNotEmpty)
          _Section(title: 'Mô tả', child: Text(description)),
        _Section(
          title: 'Chủ nhà',
          child: _Owner(property: property),
        ),
        _Section(
          title: 'Xác minh',
          child: Column(
            children: [
              _InfoRow(
                label: 'Tình trạng',
                value: labelOf(verificationLabels, property.verificationStatus),
              ),
              if (property.lastVerifiedAt case final at?)
                _InfoRow(label: 'Xác minh lần cuối', value: vnDate(at)),
              _InfoRow(
                label: 'Cập nhật',
                value:
                    '${vnTime(property.updatedAt)} ${vnDate(property.updatedAt)}',
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Owner extends StatelessWidget {
  const _Owner({required this.property});

  final PropertyDetail property;

  @override
  Widget build(BuildContext context) {
    final muted = context.appColors.mutedForeground;
    if (!property.ownerContactVisible) {
      return Text(
        'Bạn không được xem liên hệ chủ nhà và địa chỉ chi tiết của BĐS này.',
        style: TextStyle(color: muted),
      );
    }
    final owner = property.owner;
    if (owner == null) {
      return Text('Chưa có thông tin chủ nhà.', style: TextStyle(color: muted));
    }
    return Column(
      children: [
        _InfoRow(label: 'Họ tên', value: owner.fullName),
        _InfoRow(label: 'Điện thoại', value: owner.phone, selectable: true),
        if (owner.email case final email?)
          _InfoRow(label: 'Email', value: email, selectable: true),
        if (owner.notes case final notes? when notes.trim().isNotEmpty)
          _InfoRow(label: 'Ghi chú', value: notes),
      ],
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(
      AppSpacing.gutter,
      AppSpacing.s8,
      AppSpacing.gutter,
      AppSpacing.s16,
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: AppSpacing.s8),
        child,
      ],
    ),
  );
}

/// Một dòng "nhãn — giá trị"; nhãn cột trái cố định, giá trị xuống dòng khi dài.
class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.label,
    required this.value,
    this.selectable = false,
  });

  final String label;
  final String value;
  final bool selectable;

  @override
  Widget build(BuildContext context) {
    final muted = context.appColors.mutedForeground;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.s4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 128,
            child: Text(label, style: TextStyle(color: muted)),
          ),
          const SizedBox(width: AppSpacing.s8),
          Expanded(child: selectable ? SelectableText(value) : Text(value)),
        ],
      ),
    );
  }
}
