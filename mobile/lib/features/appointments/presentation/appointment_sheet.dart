import 'package:flutter/material.dart';

import '../../../core/format/vn_format.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/detail_section.dart';
import '../../properties/domain/property_labels.dart';
import '../domain/appointment.dart';
import 'appointment_tile.dart';

/// Bảng chi tiết lịch hẹn. [canManage] (`appointment.manage`) thì đổi được trạng thái: "Đã xem" (kèm kết quả nếu
/// có) và "Khách không đến" chỉ chọn được khi đã tới giờ hẹn ([now]). Trả trạng thái và kết quả mới, hoặc null khi
/// đóng.
Future<({String status, String? outcome})?> showAppointmentSheet(
  BuildContext context, {
  required Appointment appointment,
  required bool canManage,
  required DateTime now,
}) => showModalBottomSheet(
  context: context,
  isScrollControlled: true,
  useRootNavigator: true,
  useSafeArea: true,
  showDragHandle: true,
  builder: (context) => _AppointmentSheet(
    appointment: appointment,
    canManage: canManage,
    started: !appointment.scheduledAt.isAfter(now),
  ),
);

const _afterStart = {'COMPLETED', 'NO_SHOW'};

class _AppointmentSheet extends StatefulWidget {
  const _AppointmentSheet({
    required this.appointment,
    required this.canManage,
    required this.started,
  });

  final Appointment appointment;
  final bool canManage;
  final bool started;

  @override
  State<_AppointmentSheet> createState() => _AppointmentSheetState();
}

class _AppointmentSheetState extends State<_AppointmentSheet> {
  late var _status = widget.appointment.status;
  late String? _outcome = widget.appointment.outcome;

  @override
  Widget build(BuildContext context) {
    final appointment = widget.appointment;
    final theme = Theme.of(context);
    final outcome = _status == 'COMPLETED' ? _outcome : null;
    final unchanged =
        _status == appointment.status && outcome == appointment.outcome;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.gutter,
        0,
        AppSpacing.gutter,
        AppSpacing.gutter,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Lịch hẹn', style: theme.textTheme.titleLarge),
          const SizedBox(height: AppSpacing.s8),
          InfoRow(
            label: 'Thời gian',
            value:
                '${appointmentTimeRange(appointment)}, ${vnWeekdayDate(appointment.scheduledAt)}',
          ),
          InfoRow(label: 'Khách', value: appointment.customerName),
          InfoRow(
            label: 'BĐS',
            value: '${appointment.propertyCode} · ${appointment.propertyTitle}',
          ),
          if (appointment.location case final location?)
            InfoRow(label: 'Địa điểm', value: location),
          if (appointment.notes case final notes? when notes.trim().isNotEmpty)
            InfoRow(label: 'Ghi chú', value: notes),
          InfoRow(
            label: 'Trạng thái',
            value: labelOf(appointmentStatusLabels, appointment.status),
          ),
          if (appointment.outcome case final outcome?)
            InfoRow(
              label: 'Kết quả',
              value: labelOf(appointmentOutcomeLabels, outcome),
            ),
          if (widget.canManage) ...[
            const SizedBox(height: AppSpacing.s16),
            Text('Đổi trạng thái', style: theme.textTheme.titleMedium),
            RadioGroup<String>(
              groupValue: _status,
              onChanged: (value) => setState(() => _status = value!),
              child: Column(
                children: [
                  for (final MapEntry(key: status, value: label)
                      in appointmentStatusLabels.entries)
                    RadioListTile<String>(
                      value: status,
                      title: Text(label),
                      enabled:
                          widget.started ||
                          !_afterStart.contains(status) ||
                          status == appointment.status,
                      subtitle: !widget.started && _afterStart.contains(status)
                          ? Text(
                              'Chưa tới giờ hẹn',
                              style: TextStyle(
                                color: context.appColors.mutedForeground,
                              ),
                            )
                          : null,
                      contentPadding: EdgeInsets.zero,
                    ),
                ],
              ),
            ),
            if (_status == 'COMPLETED')
              DropdownButtonFormField<String?>(
                initialValue: _outcome,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Kết quả buổi xem',
                ),
                items: [
                  const DropdownMenuItem(value: null, child: Text('Chưa ghi')),
                  for (final MapEntry(key: value, value: label)
                      in appointmentOutcomeLabels.entries)
                    DropdownMenuItem(value: value, child: Text(label)),
                ],
                onChanged: (value) => setState(() => _outcome = value),
              ),
            const SizedBox(height: AppSpacing.s16),
            FilledButton(
              onPressed: unchanged
                  ? null
                  : () =>
                        Navigator.of(context)
                            .pop((status: _status, outcome: outcome)),
              child: const Text('Lưu'),
            ),
          ],
        ],
      ),
    );
  }
}
