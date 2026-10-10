import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/error_retry.dart';
import '../domain/picked_image.dart';
import '../domain/property_detail.dart';
import 'property_detail_providers.dart';
import 'property_images_controller.dart';
import 'property_list_controller.dart';

/// Quản lý ảnh BĐS (cần `property.edit` với BĐS): thêm từ thư viện hoặc chụp, tải lên lần lượt; chạm ảnh để đặt
/// làm ảnh bìa hoặc xoá. Tối đa 30 ảnh, mỗi ảnh ≤ 10MB.
class PropertyImagesScreen extends ConsumerWidget {
  const PropertyImagesScreen({super.key, required this.propertyId});

  final String propertyId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final images = ref.watch(propertyImagesProvider(propertyId));
    final uploads = ref.watch(propertyImageUploadsProvider(propertyId));
    final uploading = uploads.any((upload) => !upload.failed);
    final remaining = switch (images) {
      AsyncData(:final value) =>
        maxImagesPerProperty - value.length - uploads.length,
      _ => 0,
    };

    return PopScope(
      canPop: !uploading,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) {
          return;
        }
        final leave = await _confirm(
          context,
          title: 'Dừng tải ảnh?',
          message: 'Ảnh chưa tải xong sẽ không được thêm vào BĐS.',
          action: 'Rời đi',
        );
        if (leave && context.mounted) {
          ref.invalidate(propertyImageUploadsProvider(propertyId));
          Navigator.of(context).pop();
        }
      },
      child: Scaffold(
        appBar: AppBar(title: const Text('Ảnh BĐS')),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: remaining > 0 ? () => _add(context, ref, remaining) : null,
          icon: const Icon(Icons.add_photo_alternate_outlined),
          label: const Text('Thêm ảnh'),
        ),
        body: switch (images) {
          AsyncValue(:final value?) => _Grid(
            propertyId: propertyId,
            images: value,
            uploads: uploads,
          ),
          AsyncError(:final error) => Center(
            child: Padding(
              padding: const EdgeInsets.all(AppSpacing.gutter),
              child: ErrorRetry(
                error: error,
                onRetry: () =>
                    ref.invalidate(propertyImagesProvider(propertyId)),
              ),
            ),
          ),
          _ => const Center(child: CircularProgressIndicator()),
        },
      ),
    );
  }

  Future<void> _add(BuildContext context, WidgetRef ref, int remaining) async {
    final source = await showModalBottomSheet<PickSource>(
      context: context,
      useRootNavigator: true,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Chọn từ thư viện'),
              onTap: () => Navigator.of(context).pop(PickSource.gallery),
            ),
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Chụp ảnh'),
              onTap: () => Navigator.of(context).pop(PickSource.camera),
            ),
          ],
        ),
      ),
    );
    if (source == null) {
      return;
    }
    final List<PickedImage> picked;
    try {
      picked = await ref.read(imagePickerProvider)(source, remaining);
    } on Object {
      if (context.mounted) {
        _snack(
          context,
          'Không mở được ảnh. Hãy cho app quyền truy cập ảnh/máy ảnh trong Cài đặt.',
        );
      }
      return;
    }
    if (picked.isNotEmpty) {
      ref.read(propertyImageUploadsProvider(propertyId).notifier).add(picked);
    }
  }
}

class _Grid extends ConsumerWidget {
  const _Grid({
    required this.propertyId,
    required this.images,
    required this.uploads,
  });

  final String propertyId;
  final List<PropertyImage> images;
  final List<ImageUpload> uploads;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final muted = context.appColors.mutedForeground;
    final count = images.length + uploads.length;
    return CustomScrollView(
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.gutter,
            AppSpacing.gutter,
            AppSpacing.gutter,
            AppSpacing.s8,
          ),
          sliver: SliverToBoxAdapter(
            child: Text(
              count == 0
                  ? 'Chưa có ảnh. Bấm "Thêm ảnh" để chọn từ thư viện hoặc chụp.'
                  : '$count/$maxImagesPerProperty ảnh · Chạm ảnh để đặt làm ảnh bìa hoặc xoá.',
              style: TextStyle(color: muted),
            ),
          ),
        ),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.gutter,
            0,
            AppSpacing.gutter,
            96,
          ),
          sliver: SliverGrid.count(
            crossAxisCount: 3,
            mainAxisSpacing: AppSpacing.s8,
            crossAxisSpacing: AppSpacing.s8,
            children: [
              for (final image in images)
                _ImageTile(
                  key: ValueKey(image.id),
                  image: image,
                  onTap: () => _imageActions(context, ref, image),
                ),
              for (final upload in uploads)
                _UploadTile(
                  key: ValueKey('upload-${upload.id}'),
                  upload: upload,
                  onTap: upload.failed
                      ? () => _uploadActions(context, ref, upload)
                      : null,
                ),
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _imageActions(
    BuildContext context,
    WidgetRef ref,
    PropertyImage image,
  ) async {
    final action = await showModalBottomSheet<String>(
      context: context,
      useRootNavigator: true,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (!image.isCover)
              ListTile(
                leading: const Icon(Icons.star_outline),
                title: const Text('Đặt làm ảnh bìa'),
                onTap: () => Navigator.of(context).pop('cover'),
              ),
            ListTile(
              leading: Icon(
                Icons.delete_outline,
                color: Theme.of(context).colorScheme.error,
              ),
              title: Text(
                'Xoá ảnh',
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
              onTap: () => Navigator.of(context).pop('delete'),
            ),
          ],
        ),
      ),
    );
    if (action == null || !context.mounted) {
      return;
    }
    if (action == 'delete' &&
        !await _confirm(
          context,
          title: 'Xoá ảnh này?',
          message: image.isCover
              ? 'Đây là ảnh bìa; ảnh đầu tiên còn lại sẽ thành ảnh bìa.'
              : 'Ảnh sẽ không còn hiện trên BĐS.',
          action: 'Xoá',
        )) {
      return;
    }
    final repository = ref.read(propertyImagesRepositoryProvider);
    try {
      if (action == 'cover') {
        await repository.setCover(propertyId, image.id);
      } else {
        await repository.delete(propertyId, image.id);
      }
      ref.invalidate(propertyImagesProvider(propertyId));
      ref.invalidate(propertyListProvider);
      if (context.mounted) {
        _snack(context, action == 'cover' ? 'Đã đặt ảnh bìa.' : 'Đã xoá ảnh.');
      }
    } on Object catch (error) {
      if (context.mounted) {
        _snack(context, ErrorRetry.messageOf(error));
      }
    }
  }

  Future<void> _uploadActions(
    BuildContext context,
    WidgetRef ref,
    ImageUpload upload,
  ) async {
    final uploads = ref.read(propertyImageUploadsProvider(propertyId).notifier);
    final action = await showModalBottomSheet<String>(
      context: context,
      useRootNavigator: true,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(title: Text(upload.error!)),
            if (upload.image.problem == null)
              ListTile(
                leading: const Icon(Icons.refresh),
                title: const Text('Thử lại'),
                onTap: () => Navigator.of(context).pop('retry'),
              ),
            ListTile(
              leading: const Icon(Icons.close),
              title: const Text('Bỏ ảnh này'),
              onTap: () => Navigator.of(context).pop('remove'),
            ),
          ],
        ),
      ),
    );
    switch (action) {
      case 'retry':
        uploads.retry(upload.id);
      case 'remove':
        uploads.remove(upload.id);
    }
  }
}

class _ImageTile extends StatelessWidget {
  const _ImageTile({super.key, required this.image, required this.onTap});

  final PropertyImage image;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ClipRRect(
      borderRadius: const BorderRadius.all(AppRadius.md),
      child: Material(
        color: scheme.surfaceContainerHighest,
        child: InkWell(
          onTap: onTap,
          child: Stack(
            fit: StackFit.expand,
            children: [
              Image.network(
                image.thumbnailUrl ?? image.url,
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) => Icon(
                  Icons.broken_image_outlined,
                  color: scheme.onSurfaceVariant,
                ),
              ),
              if (image.isCover)
                const Positioned(
                  left: AppSpacing.s4,
                  top: AppSpacing.s4,
                  child: _Badge(text: 'Ảnh bìa'),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _UploadTile extends StatelessWidget {
  const _UploadTile({super.key, required this.upload, this.onTap});

  final ImageUpload upload;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: const BorderRadius.all(AppRadius.md),
      child: GestureDetector(
        onTap: onTap,
        child: Stack(
          fit: StackFit.expand,
          children: [
            Image.memory(
              upload.image.bytes,
              fit: BoxFit.cover,
              errorBuilder: (context, error, stackTrace) =>
                  const ColoredBox(color: Colors.black26),
            ),
            ColoredBox(
              color: Colors.black45,
              child: Center(
                child: upload.failed
                    ? Semantics(
                        label: 'Tải lỗi: ${upload.error}',
                        child: const Icon(
                          Icons.error_outline,
                          color: Colors.white,
                          size: 32,
                        ),
                      )
                    : CircularProgressIndicator(
                        value: upload.progress > 0 ? upload.progress : null,
                        color: Colors.white,
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.primary,
      borderRadius: const BorderRadius.all(AppRadius.full),
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.s8,
        vertical: AppSpacing.s2,
      ),
      child: Text(
        text,
        style: Theme.of(context).textTheme.labelSmall
            ?.copyWith(color: Theme.of(context).colorScheme.onPrimary),
      ),
    ),
  );
}

void _snack(BuildContext context, String message) =>
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));

Future<bool> _confirm(
  BuildContext context, {
  required String title,
  required String message,
  required String action,
}) async =>
    await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Huỷ'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(action),
          ),
        ],
      ),
    ) ??
    false;
