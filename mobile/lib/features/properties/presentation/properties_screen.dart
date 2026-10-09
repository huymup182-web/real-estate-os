import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/format/vn_format.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/error_retry.dart';
import 'property_card.dart';
import 'property_list_controller.dart';

/// Tab "BĐS": danh sách BĐS trong phạm vi xem, mới tạo trước. Cuộn gần cuối thì tải thêm, kéo xuống để tải
/// lại. Tìm kiếm, lọc thêm ở TASK-119, TASK-120; chi tiết ở TASK-121.
class PropertiesScreen extends ConsumerWidget {
  const PropertiesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = ref.watch(propertyListProvider);
    final controller = ref.read(propertyListProvider.notifier);

    Future<void> refresh() async {
      final error = await controller.refresh();
      if (error != null && context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(ErrorRetry.messageOf(error))));
      }
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Bất động sản')),
      body: switch (list) {
        AsyncData(:final value) => RefreshIndicator(
          onRefresh: refresh,
          child: value.items.isEmpty
              ? ListView(
                  children: const [
                    SizedBox(height: AppSpacing.s48),
                    _Empty(),
                  ],
                )
              : NotificationListener<ScrollNotification>(
                  onNotification: (notification) {
                    // Đang lỗi tải thêm thì chờ người dùng bấm "Thử lại", không gọi lại theo mỗi lần cuộn.
                    if (notification.metrics.extentAfter < 600 &&
                        value.loadMoreError == null) {
                      controller.loadMore();
                    }
                    return false;
                  },
                  child: ListView.separated(
                    padding: const EdgeInsets.all(AppSpacing.gutter),
                    itemCount: value.items.length + 2,
                    separatorBuilder: (context, index) =>
                        const SizedBox(height: AppSpacing.s12),
                    itemBuilder: (context, index) {
                      if (index == 0) {
                        return Text(
                          '${vnNumber(value.total)} BĐS',
                          style: Theme.of(context).textTheme.bodyMedium
                              ?.copyWith(
                                color: context.appColors.mutedForeground,
                              ),
                        );
                      }
                      if (index == value.items.length + 1) {
                        // Cuối danh sách đã hiện mà còn trang sau (danh sách ngắn không cuộn được) thì tải luôn.
                        if (value.hasMore &&
                            !value.loadingMore &&
                            value.loadMoreError == null) {
                          Future.microtask(controller.loadMore);
                        }
                        return _Footer(
                          loading: value.loadingMore || value.hasMore,
                          error: value.loadMoreError,
                          onRetry: controller.loadMore,
                        );
                      }
                      return PropertyCard(property: value.items[index - 1]);
                    },
                  ),
                ),
        ),
        AsyncError(:final error) => Center(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.gutter),
            child: ErrorRetry(
              error: error,
              onRetry: () => ref.invalidate(propertyListProvider),
            ),
          ),
        ),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty();

  @override
  Widget build(BuildContext context) {
    final muted = context.appColors.mutedForeground;
    return Column(
      children: [
        Icon(Icons.apartment, size: 48, color: muted),
        const SizedBox(height: AppSpacing.s8),
        Text(
          'Chưa có BĐS nào.',
          style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: muted),
        ),
      ],
    );
  }
}

/// Cuối danh sách: đang tải thêm, lỗi tải thêm (nút thử lại), hoặc trống khi đã hết.
class _Footer extends StatelessWidget {
  const _Footer({
    required this.loading,
    required this.error,
    required this.onRetry,
  });

  final bool loading;
  final Object? error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    if (error != null) {
      return ErrorRetry(error: error!, onRetry: onRetry);
    }
    if (loading) {
      return const Padding(
        padding: EdgeInsets.all(AppSpacing.s16),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    return const SizedBox(height: AppSpacing.s16);
  }
}
