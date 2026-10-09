import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/api_exception.dart';
import '../../../core/format/vn_format.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/detail_section.dart';
import '../../../core/widgets/error_retry.dart';
import '../../auth/presentation/session_controller.dart';
import '../../locations/domain/location_option.dart';
import '../../locations/presentation/location_providers.dart';
import '../../properties/domain/property_labels.dart' show labelOf;
import '../domain/customer_detail.dart';
import '../domain/customer_labels.dart';
import '../domain/preference_summary.dart';
import 'customer_card.dart';
import 'customer_detail_providers.dart';

/// Chi tiết khách: thông tin liên hệ, nhu cầu, môi giới phụ trách, ghi chú và timeline chăm sóc. Kéo xuống để tải
/// lại.
class CustomerDetailScreen extends ConsumerWidget {
  const CustomerDetailScreen({super.key, required this.customerId});

  final String customerId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(customerDetailProvider(customerId));

    // Kéo xuống tải lại: đang có dữ liệu thì giữ, lỗi thì báo snackbar.
    Future<void> refresh() async {
      ref.invalidate(customerPreferencesProvider(customerId));
      ref.invalidate(customerActivitiesProvider(customerId));
      ref.invalidate(customerDetailProvider(customerId));
      try {
        await ref.read(customerDetailProvider(customerId).future);
      } on Object catch (error) {
        if (context.mounted) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(ErrorRetry.messageOf(error))));
        }
      }
    }

    return Scaffold(
      appBar: AppBar(title: Text(detail.value?.fullName ?? 'Khách hàng')),
      body: switch (detail) {
        AsyncValue(:final value?) => RefreshIndicator(
          onRefresh: refresh,
          child: _Body(customer: value),
        ),
        AsyncError(:final error) => Center(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.gutter),
            child: error is ApiException && error.code == ErrorCodes.notFound
                ? Text(
                    'Không tìm thấy khách, hoặc bạn không có quyền xem khách này.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyLarge,
                  )
                : ErrorRetry(
                    error: error,
                    onRetry: () =>
                        ref.invalidate(customerDetailProvider(customerId)),
                  ),
          ),
        ),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }
}

class _Body extends ConsumerWidget {
  const _Body({required this.customer});

  final CustomerDetail customer;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    String label(Map<String, String> labels, String? value) =>
        value == null ? '—' : labelOf(labels, value);

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(bottom: AppSpacing.s24),
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.gutter,
            AppSpacing.s16,
            AppSpacing.gutter,
            AppSpacing.s8,
          ),
          child: Wrap(
            spacing: AppSpacing.s8,
            runSpacing: AppSpacing.s8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(customer.fullName, style: theme.textTheme.headlineSmall),
              CustomerStatusBadge(status: customer.status),
            ],
          ),
        ),
        DetailSection(
          title: 'Thông tin',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              InfoRow(
                label: 'Điện thoại',
                value: vnPhone(customer.phone),
                selectable: true,
              ),
              InfoRow(
                label: 'Email',
                value: customer.email ?? '—',
                selectable: customer.email != null,
              ),
              InfoRow(
                label: 'Mục đích',
                value: label(customerPurposeLabels, customer.purpose),
              ),
              InfoRow(
                label: 'Thời gian mua',
                value: label(purchaseTimelineLabels, customer.purchaseTimeline),
              ),
              InfoRow(
                label: 'Nguồn khách',
                value: label(customerSourceLabels, customer.source),
              ),
              InfoRow(label: 'Môi giới', value: _agentText(ref)),
              if (customer.status == 'LOST')
                InfoRow(
                  label: 'Lý do mất khách',
                  value: customer.lostReason ?? '—',
                ),
              InfoRow(label: 'Ngày tạo', value: vnDate(customer.createdAt)),
              if (customer.notes case final notes?) ...[
                const SizedBox(height: AppSpacing.s8),
                Text(notes),
              ],
            ],
          ),
        ),
        DetailSection(
          title: 'Nhu cầu',
          child: _Preferences(customerId: customer.id),
        ),
        DetailSection(
          title: 'Hoạt động',
          child: _Timeline(customerId: customer.id),
        ),
      ],
    );
  }

  /// Chưa giao → "Chưa giao"; là mình → tên mình kèm "(bạn)"; người khác → tên nếu xem được, không thì "—".
  String _agentText(WidgetRef ref) {
    final agentId = customer.agentId;
    if (agentId == null) {
      return 'Chưa giao';
    }
    final me = ref.watch(sessionProvider).value?.user;
    if (me?.id == agentId) {
      return '${me!.fullName} (bạn)';
    }
    return ref.watch(agentNameProvider(agentId)).value ?? '—';
  }
}

class _Preferences extends ConsumerWidget {
  const _Preferences({required this.customerId});

  final String customerId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final muted = context.appColors.mutedForeground;
    final provinceNames = <String, String>{
      for (final province
          in ref.watch(provincesProvider).value ?? const <LocationOption>[])
        province.id: province.name,
    };
    return switch (ref.watch(customerPreferencesProvider(customerId))) {
      AsyncData(:final value) when value.isEmpty => Text(
        'Chưa nhập nhu cầu.',
        style: TextStyle(color: muted),
      ),
      AsyncData(:final value) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final preference in value)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.s4),
              child: Text.rich(
                TextSpan(
                  text: preferenceSummary(preference, provinceNames),
                  children: [
                    if (!preference.isActive)
                      TextSpan(
                        text: ' (tạm dừng)',
                        style: TextStyle(color: muted),
                      ),
                  ],
                ),
              ),
            ),
        ],
      ),
      AsyncError(:final error) => ErrorRetry(
        error: error,
        onRetry: () => ref.invalidate(customerPreferencesProvider(customerId)),
      ),
      _ => const _Loading(),
    };
  }
}

class _Timeline extends ConsumerWidget {
  const _Timeline({required this.customerId});

  final String customerId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final muted = context.appColors.mutedForeground;
    final timeline = ref.watch(customerActivitiesProvider(customerId));
    return switch (timeline) {
      AsyncData(:final value) when value.items.isEmpty => Text(
        'Chưa có hoạt động nào.',
        style: TextStyle(color: muted),
      ),
      AsyncData(:final value) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final activity in value.items) _ActivityTile(activity: activity),
          if (value.loadMoreError case final error?)
            ErrorRetry(
              error: error,
              onRetry: ref
                  .read(customerActivitiesProvider(customerId).notifier)
                  .loadMore,
            )
          else if (value.loadingMore)
            const _Loading()
          else if (value.hasMore)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: ref
                    .read(customerActivitiesProvider(customerId).notifier)
                    .loadMore,
                child: const Text('Xem thêm'),
              ),
            ),
        ],
      ),
      AsyncError(:final error) => ErrorRetry(
        error: error,
        onRetry: () => ref.invalidate(customerActivitiesProvider(customerId)),
      ),
      _ => const _Loading(),
    };
  }
}

class _ActivityTile extends StatelessWidget {
  const _ActivityTile({required this.activity});

  final CustomerActivity activity;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = context.appColors.mutedForeground;
    final heading = [
      '${vnTime(activity.occurredAt)} ${vnDate(activity.occurredAt)}',
      labelOf(activityTypeLabels, activity.type),
      ?activity.userName,
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.s8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            heading,
            style: theme.textTheme.bodySmall?.copyWith(color: muted),
          ),
          if (activity.content case final content?) ...[
            const SizedBox(height: AppSpacing.s2),
            Text(content),
          ],
        ],
      ),
    );
  }
}

class _Loading extends StatelessWidget {
  const _Loading();

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.all(AppSpacing.s16),
    child: Center(child: CircularProgressIndicator()),
  );
}
