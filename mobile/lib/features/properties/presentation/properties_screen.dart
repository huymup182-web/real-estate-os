import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/format/vn_format.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/error_retry.dart';
import '../domain/property_query.dart';
import 'property_card.dart';
import 'property_filter_sheet.dart';
import 'property_list_controller.dart';
import 'property_search_field.dart';

/// Tab "BĐS": ô tìm kiếm và danh sách BĐS trong phạm vi xem (mới tạo trước, có từ khoá thì khớp nhiều hơn trước).
/// Nút "Bộ lọc" mở bộ lọc, sắp xếp. Cuộn gần cuối thì tải thêm, kéo xuống để tải lại. Chi tiết ở TASK-121.
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
      body: Column(
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(
              AppSpacing.gutter,
              AppSpacing.s8,
              AppSpacing.gutter,
              AppSpacing.s8,
            ),
            child: Row(
              children: [
                Expanded(child: PropertySearchField()),
                SizedBox(width: AppSpacing.s8),
                _FilterButton(),
              ],
            ),
          ),
          Expanded(child: _body(context, ref, list, controller, refresh)),
        ],
      ),
    );
  }

  Widget _body(
    BuildContext context,
    WidgetRef ref,
    AsyncValue<PropertyListState> list,
    PropertyListController controller,
    Future<void> Function() refresh,
  ) {
    return switch (list) {
      AsyncData(:final value) => RefreshIndicator(
        onRefresh: refresh,
        child: value.items.isEmpty
            ? ListView(
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                children: [
                  const SizedBox(height: AppSpacing.s48),
                  _Empty(
                    query: value.query,
                    onClearFilters: ref
                        .read(propertyQueryProvider.notifier)
                        .clearFilters,
                  ),
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
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.gutter,
                    AppSpacing.s8,
                    AppSpacing.gutter,
                    AppSpacing.gutter,
                  ),
                  itemCount: value.items.length + 2,
                  separatorBuilder: (context, index) =>
                      const SizedBox(height: AppSpacing.s12),
                  itemBuilder: (context, index) {
                    if (index == 0) {
                      return Text(
                        value.query.isEmpty
                            ? '${vnNumber(value.total)} BĐS'
                            : '${vnNumber(value.total)} kết quả',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
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
    };
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.query, required this.onClearFilters});

  final PropertyQuery query;
  final VoidCallback onClearFilters;

  @override
  Widget build(BuildContext context) {
    final muted = context.appColors.mutedForeground;
    final message = query.keyword.isNotEmpty
        ? 'Không tìm thấy BĐS khớp "${query.keyword}".'
        : query.hasFilters
        ? 'Không có BĐS nào khớp bộ lọc.'
        : 'Chưa có BĐS nào.';
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.gutter),
      child: Column(
        children: [
          Icon(
            query.isEmpty ? Icons.apartment : Icons.search_off,
            size: 48,
            color: muted,
          ),
          const SizedBox(height: AppSpacing.s8),
          Text(
            message,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyLarge
                ?.copyWith(color: muted),
          ),
          if (query.hasFilters) ...[
            const SizedBox(height: AppSpacing.s8),
            TextButton(
              onPressed: onClearFilters,
              child: const Text('Xoá bộ lọc'),
            ),
          ],
        ],
      ),
    );
  }
}

/// Mở bộ lọc; số trên nút là số nhóm lọc/sắp xếp đang dùng.
class _FilterButton extends ConsumerWidget {
  const _FilterButton();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final query = ref.watch(propertyQueryProvider);
    return Badge(
      isLabelVisible: query.hasFilters,
      label: Text('${query.filterCount}'),
      child: IconButton.outlined(
        tooltip: 'Bộ lọc',
        icon: const Icon(Icons.tune),
        onPressed: () async {
          final filters = await showPropertyFilterSheet(context, query);
          if (filters != null && context.mounted) {
            ref.read(propertyQueryProvider.notifier).applyFilters(filters);
          }
        },
      ),
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
