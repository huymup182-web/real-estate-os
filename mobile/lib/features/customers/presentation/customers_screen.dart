import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/format/vn_format.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/debounced_search_field.dart';
import '../../../core/widgets/error_retry.dart';
import '../../../core/widgets/load_more_footer.dart';
import '../domain/customer_labels.dart';
import '../domain/customer_query.dart';
import 'customer_card.dart';
import 'customer_list_controller.dart';

/// Tab "Khách hàng": tìm theo tên, số điện thoại, email; lọc theo bước pipeline (chọn nhiều); danh sách khách
/// trong phạm vi xem, mới tạo trước. Cuộn gần cuối thì tải thêm, kéo xuống để tải lại. Chạm thẻ để xem chi tiết;
/// nút trên thanh tiêu đề mở pipeline.
class CustomersScreen extends ConsumerWidget {
  const CustomersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = ref.watch(customerListProvider);
    final query = ref.watch(customerQueryProvider);
    final queryController = ref.read(customerQueryProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Khách hàng'),
        actions: [
          IconButton(
            tooltip: 'Pipeline',
            icon: const Icon(Icons.view_kanban_outlined),
            onPressed: () => context.push(AppRoutes.customerPipeline),
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
              0,
            ),
            child: DebouncedSearchField(
              initial: query.keyword,
              hint: 'Tìm theo tên, số điện thoại, email',
              maxLength: CustomerQuery.maxKeywordLength,
              onSearch: queryController.setKeyword,
            ),
          ),
          const _StatusChips(),
          Expanded(child: _body(context, ref, list)),
        ],
      ),
    );
  }

  Widget _body(
    BuildContext context,
    WidgetRef ref,
    AsyncValue<CustomerListState> list,
  ) {
    final controller = ref.read(customerListProvider.notifier);
    final muted = context.appColors.mutedForeground;

    Future<void> refresh() async {
      final error = await controller.refresh();
      if (error != null && context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(ErrorRetry.messageOf(error))));
      }
    }

    return switch (list) {
      AsyncData(:final value) => RefreshIndicator(
        onRefresh: refresh,
        child: value.items.isEmpty
            ? ListView(
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                padding: const EdgeInsets.all(AppSpacing.gutter),
                children: [
                  const SizedBox(height: AppSpacing.s48),
                  Icon(
                    value.query.isEmpty
                        ? Icons.people_outline
                        : Icons.search_off,
                    size: 48,
                    color: muted,
                  ),
                  const SizedBox(height: AppSpacing.s8),
                  Text(
                    value.query.keyword.isNotEmpty
                        ? 'Không tìm thấy khách khớp "${value.query.keyword}".'
                        : value.query.statuses.isNotEmpty
                        ? 'Không có khách nào ở bước đã chọn.'
                        : 'Chưa có khách hàng nào.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyLarge
                        ?.copyWith(color: muted),
                  ),
                ],
              )
            : NotificationListener<ScrollNotification>(
                onNotification: (notification) {
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
                    0,
                    AppSpacing.gutter,
                    AppSpacing.s16,
                  ),
                  itemCount: value.items.length + 2,
                  separatorBuilder: (context, index) =>
                      const SizedBox(height: AppSpacing.s12),
                  itemBuilder: (context, index) {
                    if (index == 0) {
                      return Text(
                        value.query.isEmpty
                            ? '${vnNumber(value.total)} khách'
                            : '${vnNumber(value.total)} kết quả',
                        style: Theme.of(context).textTheme.bodyMedium
                            ?.copyWith(color: muted),
                      );
                    }
                    if (index == value.items.length + 1) {
                      // Cuối danh sách đã hiện mà còn trang sau (danh sách ngắn không cuộn được) thì tải luôn.
                      if (value.hasMore &&
                          !value.loadingMore &&
                          value.loadMoreError == null) {
                        Future.microtask(controller.loadMore);
                      }
                      return LoadMoreFooter(
                        loading: value.loadingMore || value.hasMore,
                        error: value.loadMoreError,
                        onRetry: controller.loadMore,
                      );
                    }
                    final customer = value.items[index - 1];
                    return CustomerCard(
                      customer: customer,
                      onTap: () =>
                          context.push(AppRoutes.customerDetail(customer.id)),
                    );
                  },
                ),
              ),
      ),
      AsyncError(:final error) => Center(
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.gutter),
          child: ErrorRetry(
            error: error,
            onRetry: () => ref.invalidate(customerListProvider),
          ),
        ),
      ),
      _ => const Center(child: CircularProgressIndicator()),
    };
  }
}

/// Hàng nút lọc theo bước. 9 nút cố định nên dựng hết một lần (không cần danh sách lười). Bước được chọn từ nơi
/// khác (màn pipeline) mà nằm khuất thì cuộn tới.
class _StatusChips extends ConsumerStatefulWidget {
  const _StatusChips();

  @override
  ConsumerState<_StatusChips> createState() => _StatusChipsState();
}

class _StatusChipsState extends ConsumerState<_StatusChips> {
  final _keys = {
    for (final status in customerStatusLabels.keys) status: GlobalKey(),
  };

  @override
  Widget build(BuildContext context) {
    final query = ref.watch(customerQueryProvider);
    final controller = ref.read(customerQueryProvider.notifier);
    ref.listen(customerQueryProvider, (previous, next) {
      final first = customerStatusLabels.keys
          .where(next.statuses.contains)
          .firstOrNull;
      if (first == null || next.statuses == previous?.statuses) {
        return;
      }
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final chip = _keys[first]!.currentContext;
        if (chip != null && chip.mounted) {
          Scrollable.ensureVisible(
            chip,
            alignmentPolicy: ScrollPositionAlignmentPolicy.keepVisibleAtEnd,
            duration: const Duration(milliseconds: 200),
          );
        }
      });
    });
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.gutter,
        vertical: AppSpacing.s8,
      ),
      child: Row(
        children: [
          FilterChip(
            label: const Text('Tất cả'),
            selected: query.statuses.isEmpty,
            onSelected: (_) => controller.clearStatuses(),
          ),
          for (final MapEntry(key: status, value: label)
              in customerStatusLabels.entries) ...[
            const SizedBox(width: AppSpacing.s8),
            FilterChip(
              key: _keys[status],
              label: Text(label),
              selected: query.statuses.contains(status),
              onSelected: (_) => controller.toggleStatus(status),
            ),
          ],
        ],
      ),
    );
  }
}
