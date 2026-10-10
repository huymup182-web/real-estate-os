import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/clock.dart';
import '../../../core/format/vn_format.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/error_retry.dart';
import '../../../core/widgets/load_more_footer.dart';
import '../../properties/domain/property_labels.dart';
import '../domain/app_notification.dart';
import 'notification_link.dart';
import 'notifications_controller.dart';

/// Tab "Thông báo": hộp thư của người đang đăng nhập, mới nhất trước; lọc "Chưa đọc". Chạm một thông báo thì
/// đánh dấu đã đọc và mở màn hình liên quan (nếu có). Nút "Đánh dấu đã đọc tất cả" khi còn thông báo chưa đọc.
/// Cuộn gần cuối thì tải thêm, kéo xuống để tải lại.
class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = ref.watch(notificationListProvider);
    final unreadOnly = ref.watch(notificationUnreadOnlyProvider);
    final unread = ref.watch(unreadCountProvider).value ?? 0;
    final controller = ref.read(notificationListProvider.notifier);

    Future<void> refresh() async {
      final error = await controller.refresh();
      if (error != null && context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(ErrorRetry.messageOf(error))));
      }
    }

    Future<void> markAll() async {
      final messenger = ScaffoldMessenger.of(context);
      final result = await controller.markAllRead();
      messenger.showSnackBar(
        SnackBar(
          content: Text(switch (result) {
            (count: final count?, error: _) =>
              'Đã đánh dấu đọc ${vnNumber(count)} thông báo.',
            (count: _, :final error) => ErrorRetry.messageOf(error!),
          }),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Thông báo'),
        actions: [
          if (unread > 0)
            IconButton(
              tooltip: 'Đánh dấu đã đọc tất cả',
              icon: const Icon(Icons.done_all),
              onPressed: markAll,
            ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.gutter,
              AppSpacing.s8,
              AppSpacing.gutter,
              AppSpacing.s8,
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    '${vnNumber(unread)} chưa đọc',
                    style: Theme.of(context).textTheme.bodyMedium
                        ?.copyWith(color: context.appColors.mutedForeground),
                  ),
                ),
                const SizedBox(width: AppSpacing.s8),
                FilterChip(
                  label: const Text('Chưa đọc'),
                  selected: unreadOnly,
                  onSelected: ref
                      .read(notificationUnreadOnlyProvider.notifier)
                      .set,
                ),
              ],
            ),
          ),
          Expanded(
            child: switch (list) {
              AsyncValue(:final value?) => _List(
                state: value,
                unreadOnly: unreadOnly,
                refresh: refresh,
                controller: controller,
              ),
              AsyncError(:final error) => Center(
                child: Padding(
                  padding: const EdgeInsets.all(AppSpacing.gutter),
                  child: ErrorRetry(
                    error: error,
                    onRetry: () => ref.invalidate(notificationListProvider),
                  ),
                ),
              ),
              _ => const Center(child: CircularProgressIndicator()),
            },
          ),
        ],
      ),
    );
  }
}

class _List extends ConsumerWidget {
  const _List({
    required this.state,
    required this.unreadOnly,
    required this.refresh,
    required this.controller,
  });

  final NotificationListState state;
  final bool unreadOnly;
  final Future<void> Function() refresh;
  final NotificationListController controller;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final muted = context.appColors.mutedForeground;
    final now = ref.watch(clockProvider)();
    if (state.items.isEmpty && !state.hasMore) {
      return RefreshIndicator(
        onRefresh: refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(AppSpacing.gutter),
          children: [
            const SizedBox(height: AppSpacing.s48),
            Icon(Icons.notifications_none, size: 48, color: muted),
            const SizedBox(height: AppSpacing.s8),
            Text(
              unreadOnly
                  ? 'Không có thông báo chưa đọc.'
                  : 'Chưa có thông báo nào.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyLarge
                  ?.copyWith(color: muted),
            ),
          ],
        ),
      );
    }
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
          itemCount: state.items.length + 1,
          separatorBuilder: (context, index) => const Divider(height: 1),
          itemBuilder: (context, index) {
            if (index == state.items.length) {
              if (state.hasMore &&
                  !state.loadingMore &&
                  state.loadMoreError == null) {
                Future.microtask(controller.loadMore);
              }
              return LoadMoreFooter(
                loading: state.loadingMore || state.hasMore,
                error: state.loadMoreError,
                onRetry: controller.loadMore,
              );
            }
            final item = state.items[index];
            return _NotificationTile(
              notification: item,
              now: now,
              onTap: () => _open(context, item),
            );
          },
        ),
      ),
    );
  }

  Future<void> _open(BuildContext context, AppNotification item) async {
    final messenger = ScaffoldMessenger.of(context);
    final link = notificationLink(item);
    if (link != null) {
      context.go(link);
    }
    if (item.unread) {
      final error = await controller.markRead(item.id);
      if (error != null) {
        messenger.showSnackBar(
          SnackBar(content: Text(ErrorRetry.messageOf(error))),
        );
      }
    }
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({
    required this.notification,
    required this.now,
    required this.onTap,
  });

  final AppNotification notification;
  final DateTime now;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = context.appColors.mutedForeground;
    final unread = notification.unread;
    return Semantics(
      label: unread ? 'Chưa đọc' : null,
      child: InkWell(
        onTap: onTap,
        child: Container(
          color: unread
              ? theme.colorScheme.primary.withValues(alpha: 0.06)
              : null,
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.gutter,
            vertical: AppSpacing.s12,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: SizedBox.square(
                  dimension: 8,
                  child: unread
                      ? DecoratedBox(
                          key: const Key('unread-dot'),
                          decoration: BoxDecoration(
                            color: theme.colorScheme.primary,
                            shape: BoxShape.circle,
                          ),
                        )
                      : null,
                ),
              ),
              const SizedBox(width: AppSpacing.s12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      notification.title,
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: unread ? FontWeight.w700 : null,
                      ),
                    ),
                    if (notification.body.trim().isNotEmpty)
                      Text(
                        notification.body,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                      ),
                    const SizedBox(height: AppSpacing.s4),
                    Text(
                      '${vnTime(notification.createdAt)} ${vnDayLabel(notification.createdAt, now)} · '
                      '${labelOf(notificationTypeLabels, notification.type)}',
                      style: theme.textTheme.bodySmall?.copyWith(color: muted),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
