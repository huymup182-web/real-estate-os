import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/clock.dart';
import '../../../core/error/api_exception.dart';
import '../../../core/format/vn_format.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/error_retry.dart';
import '../../auth/presentation/session_controller.dart';
import '../../properties/domain/property_labels.dart';
import '../domain/appointment.dart';
import 'appointment_sheet.dart';
import 'appointment_tile.dart';
import 'calendar_controller.dart';

const _weekdayHeaders = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

/// Lịch hẹn theo tháng (giờ Việt Nam): lưới ngày có số lịch mỗi ngày, bên dưới là lịch của ngày đang chọn. Chạm
/// một lịch để xem chi tiết và đổi trạng thái (khi có `appointment.manage`). Kéo xuống để tải lại.
class CalendarScreen extends ConsumerWidget {
  const CalendarScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final (:month, :day) = ref.watch(calendarProvider);
    final calendar = ref.read(calendarProvider.notifier);
    final appointments = ref.watch(monthAppointmentsProvider(month));
    final now = ref.watch(clockProvider)();
    final byDay = appointments.value ?? const <int, List<Appointment>>{};

    Future<void> refresh() async {
      ref.invalidate(monthAppointmentsProvider(month));
      try {
        await ref.read(monthAppointmentsProvider(month).future);
      } on Object catch (error) {
        if (context.mounted) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(ErrorRetry.messageOf(error))));
        }
      }
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Lịch hẹn'),
        actions: [
          IconButton(
            tooltip: 'Hôm nay',
            icon: const Icon(Icons.today_outlined),
            onPressed: calendar.today,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: refresh,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverToBoxAdapter(
              child: _MonthHeader(
                month: month,
                loading: appointments.isLoading,
                onMove: calendar.moveMonth,
              ),
            ),
            SliverToBoxAdapter(
              child: _MonthGrid(
                month: month,
                selected: day,
                today: vnToday(now),
                counts: {
                  for (final MapEntry(:key, :value) in byDay.entries)
                    key: value.length,
                },
                onSelect: calendar.select,
              ),
            ),
            SliverToBoxAdapter(
              child: _DayHeader(
                day: day,
                count: appointments.hasValue
                    ? byDay[day.day]?.length ?? 0
                    : null,
              ),
            ),
            ...switch (appointments) {
              AsyncValue(:final value?) => _dayList(
                context,
                ref,
                value[day.day] ?? const [],
                now,
              ),
              AsyncError(:final error) => [
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.all(AppSpacing.gutter),
                    child: ErrorRetry(
                      error: error,
                      onRetry: () =>
                          ref.invalidate(monthAppointmentsProvider(month)),
                    ),
                  ),
                ),
              ],
              _ => [
                const SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.all(AppSpacing.s24),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                ),
              ],
            },
          ],
        ),
      ),
    );
  }

  List<Widget> _dayList(
    BuildContext context,
    WidgetRef ref,
    List<Appointment> items,
    DateTime now,
  ) {
    if (items.isEmpty) {
      return [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.gutter),
            child: Text(
              'Không có lịch hẹn nào trong ngày này.',
              style: TextStyle(color: context.appColors.mutedForeground),
            ),
          ),
        ),
      ];
    }
    final canManage =
        ref.watch(sessionProvider).value?.user?.can('appointment.manage') ??
        false;
    return [
      SliverPadding(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.gutter,
          0,
          AppSpacing.gutter,
          AppSpacing.s24,
        ),
        sliver: SliverToBoxAdapter(
          child: Card(
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                for (final (index, item) in items.indexed) ...[
                  if (index > 0) const Divider(height: 1),
                  AppointmentTile(
                    appointment: item,
                    onTap: () => _open(context, item, canManage, now),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    ];
  }

  Future<void> _open(
    BuildContext context,
    Appointment appointment,
    bool canManage,
    DateTime now,
  ) async {
    final container = ProviderScope.containerOf(context);
    final messenger = ScaffoldMessenger.of(context);
    final choice = await showAppointmentSheet(
      context,
      appointment: appointment,
      canManage: canManage,
      now: now,
    );
    if (choice == null) {
      return;
    }
    final error = await changeAppointmentStatus(
      container,
      appointment,
      status: choice.status,
      outcome: choice.outcome,
    );
    final label = labelOf(appointmentStatusLabels, choice.status);
    messenger.showSnackBar(
      SnackBar(
        content: Text(switch (error) {
          null => 'Đã chuyển lịch hẹn sang "$label".',
          ApiException(code: ErrorCodes.conflict) => 'Lịch hẹn vừa được người khác cập nhật. Đã tải lại, vui lòng thử lại.',
          _ => ErrorRetry.messageOf(error),
        }),
      ),
    );
  }
}

class _MonthHeader extends StatelessWidget {
  const _MonthHeader({
    required this.month,
    required this.loading,
    required this.onMove,
  });

  final VnDay month;
  final bool loading;
  final void Function(int delta) onMove;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s8),
    child: Row(
      children: [
        IconButton(
          tooltip: 'Tháng trước',
          icon: const Icon(Icons.chevron_left),
          onPressed: () => onMove(-1),
        ),
        Expanded(
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Flexible(
                child: Text(
                  'Tháng ${month.month}/${month.year}',
                  style: Theme.of(context).textTheme.titleMedium,
                  textAlign: TextAlign.center,
                ),
              ),
              if (loading) ...[
                const SizedBox(width: AppSpacing.s8),
                const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ],
            ],
          ),
        ),
        IconButton(
          tooltip: 'Tháng sau',
          icon: const Icon(Icons.chevron_right),
          onPressed: () => onMove(1),
        ),
      ],
    ),
  );
}

/// Lưới tháng, tuần bắt đầu từ thứ 2. Ngày có lịch hiện số lịch; hôm nay viền màu chính; ngày đang chọn tô màu.
class _MonthGrid extends StatelessWidget {
  const _MonthGrid({
    required this.month,
    required this.selected,
    required this.today,
    required this.counts,
    required this.onSelect,
  });

  final VnDay month;
  final VnDay selected;
  final VnDay today;
  final Map<int, int> counts;
  final ValueChanged<VnDay> onSelect;

  @override
  Widget build(BuildContext context) {
    final muted = context.appColors.mutedForeground;
    final leading = month.weekday - 1;
    final days = DateTime.utc(month.year, month.month + 1, 0).day;
    final weeks = ((leading + days) / 7).ceil();
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.s8),
      child: Column(
        children: [
          Row(
            children: [
              for (final label in _weekdayHeaders)
                Expanded(
                  child: Center(
                    child: Text(
                      label,
                      style: Theme.of(context).textTheme.labelMedium
                          ?.copyWith(color: muted),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.s4),
          for (var week = 0; week < weeks; week++)
            Row(
              children: [
                for (var column = 0; column < 7; column++)
                  Expanded(
                    child: switch (week * 7 + column - leading + 1) {
                      final number when number >= 1 && number <= days =>
                        _DayCell(
                          day: DateTime.utc(month.year, month.month, number),
                          selected: selected.day == number,
                          today:
                              today ==
                              DateTime.utc(month.year, month.month, number),
                          count: counts[number] ?? 0,
                          onSelect: onSelect,
                        ),
                      _ => const SizedBox.shrink(),
                    },
                  ),
              ],
            ),
        ],
      ),
    );
  }
}

class _DayCell extends StatelessWidget {
  const _DayCell({
    required this.day,
    required this.selected,
    required this.today,
    required this.count,
    required this.onSelect,
  });

  final VnDay day;
  final bool selected;
  final bool today;
  final int count;
  final ValueChanged<VnDay> onSelect;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final foreground = selected ? scheme.onPrimary : scheme.onSurface;
    return Semantics(
      button: true,
      selected: selected,
      label: [
        '${day.day}/${day.month}',
        if (today) 'hôm nay',
        count == 0 ? 'không có lịch hẹn' : '$count lịch hẹn',
      ].join(', '),
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.s2),
        child: Material(
          color: selected ? scheme.primary : Colors.transparent,
          shape: RoundedRectangleBorder(
            borderRadius: const BorderRadius.all(AppRadius.md),
            side: today && !selected
                ? BorderSide(color: scheme.primary)
                : BorderSide.none,
          ),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: () => onSelect(day),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 48),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    '${day.day}',
                    style: theme.textTheme.bodyLarge?.copyWith(
                      color: foreground,
                    ),
                  ),
                  Text(
                    count == 0 ? '' : '$count',
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: selected ? scheme.onPrimary : scheme.primary,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DayHeader extends StatelessWidget {
  const _DayHeader({required this.day, required this.count});

  final VnDay day;
  final int? count;

  @override
  Widget build(BuildContext context) {
    final at = vnDayStart(day.year, day.month, day.day);
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.gutter,
        AppSpacing.s16,
        AppSpacing.gutter,
        AppSpacing.s8,
      ),
      child: Text(
        [vnWeekdayDate(at), if (count != null) '$count lịch hẹn'].join(' · '),
        style: Theme.of(context).textTheme.titleMedium,
      ),
    );
  }
}
