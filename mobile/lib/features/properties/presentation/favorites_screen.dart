import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/format/vn_format.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/error_retry.dart';
import '../domain/property_summary.dart';
import 'favorites_controller.dart';
import 'properties_screen.dart';
import 'property_card.dart';
import 'property_list_controller.dart';

/// BĐS yêu thích của người dùng, mới lưu trước. Bỏ tim thì thẻ ẩn ngay, snackbar có "Hoàn tác". Cuộn gần cuối
/// thì tải thêm, kéo xuống để tải lại. Chạm thẻ để xem chi tiết.
class FavoritesScreen extends ConsumerWidget {
  const FavoritesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = ref.watch(favoriteListProvider);
    final overrides = ref.watch(favoriteOverridesProvider);
    final controller = ref.read(favoriteListProvider.notifier);

    Future<void> refresh() async {
      final error = await controller.refresh();
      if (error != null && context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(ErrorRetry.messageOf(error))));
      }
    }

    return Scaffold(
      appBar: AppBar(title: const Text('BĐS yêu thích')),
      body: switch (list) {
        AsyncValue(:final value?) => _List(
          state: value,
          visible: [
            for (final item in value.items)
              if (isFavorite(overrides, item.id, true)) item,
          ],
          refresh: refresh,
          controller: controller,
        ),
        AsyncError(:final error) => Center(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.gutter),
            child: ErrorRetry(
              error: error,
              onRetry: () => ref.invalidate(favoriteListProvider),
            ),
          ),
        ),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }
}

class _List extends StatelessWidget {
  const _List({
    required this.state,
    required this.visible,
    required this.refresh,
    required this.controller,
  });

  final PropertyListState state;
  final List<PropertySummary> visible;
  final Future<void> Function() refresh;
  final FavoriteListController controller;

  @override
  Widget build(BuildContext context) {
    final muted = context.appColors.mutedForeground;
    if (visible.isEmpty && !state.hasMore) {
      return RefreshIndicator(
        onRefresh: refresh,
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.gutter),
          children: [
            const SizedBox(height: AppSpacing.s48),
            Icon(Icons.favorite_border, size: 48, color: muted),
            const SizedBox(height: AppSpacing.s8),
            Text(
              'Chưa có BĐS yêu thích. Bấm biểu tượng tim trên BĐS để lưu lại xem sau.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyLarge
                  ?.copyWith(color: muted),
            ),
          ],
        ),
      );
    }
    final hidden = state.items.length - visible.length;
    // Context của danh sách (thẻ vừa bỏ tim đã bị gỡ, context của thẻ không dùng được).
    final listContext = context;
    return RefreshIndicator(
      onRefresh: refresh,
      child: NotificationListener<ScrollNotification>(
        onNotification: (notification) {
          if (notification.metrics.extentAfter < 600 &&
              state.loadMoreError == null) {
            controller.loadMore();
          }
          return false;
        },
        child: ListView.separated(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.gutter,
            AppSpacing.s8,
            AppSpacing.gutter,
            AppSpacing.s16,
          ),
          itemCount: visible.length + 2,
          separatorBuilder: (context, index) =>
              const SizedBox(height: AppSpacing.s12),
          itemBuilder: (context, index) {
            if (index == 0) {
              return Text(
                '${vnNumber(state.total - hidden)} BĐS',
                style: Theme.of(context).textTheme.bodyMedium
                    ?.copyWith(color: muted),
              );
            }
            if (index == visible.length + 1) {
              if (state.hasMore &&
                  !state.loadingMore &&
                  state.loadMoreError == null) {
                Future.microtask(controller.loadMore);
              }
              return PropertyListFooter(
                loading: state.loadingMore || state.hasMore,
                error: state.loadMoreError,
                onRetry: controller.loadMore,
              );
            }
            final property = visible[index - 1];
            return PropertyCard(
              property: property,
              onTap: () => context.push(AppRoutes.propertyDetail(property.id)),
              onFavoriteChanged: (favorite) {
                if (!favorite) {
                  _undoSnack(listContext, property.id);
                }
              },
            );
          },
        ),
      ),
    );
  }
}

/// Vừa bỏ tim trong danh sách yêu thích: báo kèm "Hoàn tác" (lưu lại).
void _undoSnack(BuildContext context, String propertyId) {
  if (!context.mounted) {
    return;
  }
  final messenger = ScaffoldMessenger.of(context);
  // Snackbar có thể còn sau khi rời màn này: dùng container của app, không dùng ref của widget.
  final container = ProviderScope.containerOf(context);
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: const Text('Đã bỏ khỏi yêu thích.'),
        action: SnackBarAction(
          label: 'Hoàn tác',
          onPressed: () async {
            final error = await container
                .read(favoriteOverridesProvider.notifier)
                .set(propertyId, favorite: true, current: false);
            if (error != null) {
              messenger.showSnackBar(
                SnackBar(content: Text(ErrorRetry.messageOf(error))),
              );
            }
          },
        ),
      ),
    );
}
