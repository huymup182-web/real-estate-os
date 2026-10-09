import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/widgets/error_retry.dart';
import 'favorites_controller.dart';

/// Nút tim lưu/bỏ BĐS khỏi yêu thích. [loaded] là trạng thái API trả kèm BĐS. [filled] vẽ nền tròn để nổi trên
/// ảnh. Đổi xong gọi [onChanged]; lỗi thì trả lại như cũ và báo snackbar.
class FavoriteButton extends ConsumerWidget {
  const FavoriteButton({
    super.key,
    required this.propertyId,
    required this.loaded,
    this.filled = false,
    this.onChanged,
  });

  final String propertyId;
  final bool loaded;
  final bool filled;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final favorite = isFavorite(
      ref.watch(favoriteOverridesProvider),
      propertyId,
      loaded,
    );
    final scheme = Theme.of(context).colorScheme;
    final icon = Icon(
      favorite ? Icons.favorite : Icons.favorite_border,
      color: favorite ? scheme.error : null,
    );
    // Trong danh sách yêu thích, bỏ tim thì thẻ (và nút này) ẩn ngay: lấy sẵn messenger, gọi [onChanged] cả khi
    // nút đã bị gỡ.
    Future<void> toggle() async {
      final messenger = ScaffoldMessenger.of(context);
      final error = await ref
          .read(favoriteOverridesProvider.notifier)
          .set(propertyId, favorite: !favorite, current: favorite);
      if (error == null) {
        onChanged?.call(!favorite);
      } else {
        messenger.showSnackBar(
          SnackBar(content: Text(ErrorRetry.messageOf(error))),
        );
      }
    }

    final tooltip = favorite ? 'Bỏ yêu thích' : 'Lưu yêu thích';
    return filled
        ? IconButton.filledTonal(
            tooltip: tooltip,
            onPressed: toggle,
            icon: icon,
            style: IconButton.styleFrom(
              backgroundColor: scheme.surface.withValues(alpha: 0.9),
            ),
          )
        : IconButton(tooltip: tooltip, onPressed: toggle, icon: icon);
  }
}
