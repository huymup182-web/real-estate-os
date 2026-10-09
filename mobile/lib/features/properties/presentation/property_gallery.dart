import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_tokens.dart';
import '../domain/property_detail.dart';
import 'property_detail_providers.dart';

/// Ảnh BĐS ở đầu trang chi tiết: vuốt ngang, có số thứ tự; chạm để xem cỡ lớn.
class PropertyGallery extends ConsumerStatefulWidget {
  const PropertyGallery({super.key, required this.propertyId});

  final String propertyId;

  @override
  ConsumerState<PropertyGallery> createState() => _PropertyGalleryState();
}

class _PropertyGalleryState extends ConsumerState<PropertyGallery> {
  var _index = 0;

  @override
  Widget build(BuildContext context) {
    final images = ref.watch(propertyImagesProvider(widget.propertyId));
    return AspectRatio(
      aspectRatio: 16 / 9,
      child: switch (images) {
        AsyncData(value: final items) when items.isNotEmpty => Stack(
          fit: StackFit.expand,
          children: [
            PageView.builder(
              itemCount: items.length,
              onPageChanged: (index) => setState(() => _index = index),
              itemBuilder: (context, index) => GestureDetector(
                onTap: () => _openViewer(context, items, index),
                child: _NetworkImage(
                  url: items[index].thumbnailUrl ?? items[index].url,
                ),
              ),
            ),
            Positioned(
              right: AppSpacing.s8,
              bottom: AppSpacing.s8,
              child: _Counter(text: '${_index + 1}/${items.length}'),
            ),
          ],
        ),
        AsyncData() => const _Placeholder(),
        AsyncError() => _Placeholder(
          message: 'Không tải được ảnh',
          onRetry: () =>
              ref.invalidate(propertyImagesProvider(widget.propertyId)),
        ),
        _ => const _Placeholder(loading: true),
      },
    );
  }

  void _openViewer(
    BuildContext context,
    List<PropertyImage> images,
    int index,
  ) => Navigator.of(context, rootNavigator: true).push(
    MaterialPageRoute<void>(
      fullscreenDialog: true,
      builder: (_) => PropertyImageViewer(images: images, initialIndex: index),
    ),
  );
}

/// Xem ảnh gốc toàn màn hình, vuốt ngang, chụm để phóng to.
class PropertyImageViewer extends StatefulWidget {
  const PropertyImageViewer({
    super.key,
    required this.images,
    required this.initialIndex,
  });

  final List<PropertyImage> images;
  final int initialIndex;

  @override
  State<PropertyImageViewer> createState() => _PropertyImageViewerState();
}

class _PropertyImageViewerState extends State<PropertyImageViewer> {
  late final _controller = PageController(initialPage: widget.initialIndex);
  late var _index = widget.initialIndex;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text('${_index + 1}/${widget.images.length}'),
      ),
      body: PageView.builder(
        controller: _controller,
        itemCount: widget.images.length,
        onPageChanged: (index) => setState(() => _index = index),
        itemBuilder: (context, index) => InteractiveViewer(
          maxScale: 4,
          child: _NetworkImage(
            url: widget.images[index].url,
            fit: BoxFit.contain,
          ),
        ),
      ),
    );
  }
}

class _NetworkImage extends StatelessWidget {
  const _NetworkImage({required this.url, this.fit = BoxFit.cover});

  final String url;
  final BoxFit fit;

  @override
  Widget build(BuildContext context) => Image.network(
    url,
    fit: fit,
    loadingBuilder: (context, child, progress) => progress == null
        ? child
        : const Center(child: CircularProgressIndicator()),
    errorBuilder: (context, error, stackTrace) =>
        const _Placeholder(message: 'Không tải được ảnh'),
  );
}

class _Counter extends StatelessWidget {
  const _Counter({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(
      color: Colors.black54,
      borderRadius: BorderRadius.all(AppRadius.full),
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.s8,
        vertical: AppSpacing.s2,
      ),
      child: Text(
        text,
        style: Theme.of(context).textTheme.labelMedium
            ?.copyWith(color: Colors.white),
      ),
    ),
  );
}

class _Placeholder extends StatelessWidget {
  const _Placeholder({this.message, this.onRetry, this.loading = false});

  final String? message;
  final VoidCallback? onRetry;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ColoredBox(
      color: scheme.surfaceContainerHighest,
      child: Center(
        child: loading
            ? const CircularProgressIndicator()
            : Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.apartment,
                    size: 48,
                    color: scheme.onSurfaceVariant,
                  ),
                  if (message != null)
                    Text(
                      message!,
                      style: TextStyle(color: scheme.onSurfaceVariant),
                    ),
                  if (onRetry != null)
                    TextButton(
                      onPressed: onRetry,
                      child: const Text('Thử lại'),
                    ),
                ],
              ),
      ),
    );
  }
}
