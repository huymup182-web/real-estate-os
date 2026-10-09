import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/format/vn_format.dart';
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
/// trong phạm vi xem, mới tạo trước. Cuộn gần cuối thì tải thêm, kéo xuống để tải lại.
class CustomersScreen extends ConsumerWidget {
  const CustomersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final list = ref.watch(customerListProvider);
    final query = ref.watch(customerQueryProvider);
    final queryController = ref.read(customerQueryProvider.notifier);

    return Scaffold(
      appBar: AppBar(title: const Text('Khách hàng')),
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
          // 9 nút cố định: dựng hết một lần (không cần danh sách lười).
          SingleChildScrollView(
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
                  onSelected: (_) => queryController.clearStatuses(),
                ),
                for (final MapEntry(key: status, value: label)
                    in customerStatusLabels.entries) ...[
                  const SizedBox(width: AppSpacing.s8),
                  FilterChip(
                    label: Text(label),
                    selected: query.statuses.contains(status),
                    onSelected: (_) => queryController.toggleStatus(status),
                  ),
                ],
              ],
            ),
          ),
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
                    return CustomerCard(customer: value.items[index - 1]);
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
