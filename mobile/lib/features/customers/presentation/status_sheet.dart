import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/theme/app_tokens.dart';
import '../domain/customer_labels.dart';

/// Bảng chọn bước pipeline mới cho khách đang ở [current]. Sang "Mất khách" phải nhập lý do (≤ 1000 ký tự). Trả
/// bước và lý do, hoặc null khi đóng.
Future<({String status, String? lostReason})?> showStatusSheet(
  BuildContext context, {
  required String current,
  String? lostReason,
}) => showModalBottomSheet(
  context: context,
  isScrollControlled: true,
  useRootNavigator: true,
  useSafeArea: true,
  showDragHandle: true,
  builder: (context) => _StatusSheet(current: current, lostReason: lostReason),
);

class _StatusSheet extends StatefulWidget {
  const _StatusSheet({required this.current, this.lostReason});

  final String current;
  final String? lostReason;

  @override
  State<_StatusSheet> createState() => _StatusSheetState();
}

class _StatusSheetState extends State<_StatusSheet> {
  late var _status = widget.current;
  late final _reason = TextEditingController(text: widget.lostReason);
  final _form = GlobalKey<FormState>();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  void _save() {
    if (!_form.currentState!.validate()) {
      return;
    }
    Navigator.of(context).pop((
      status: _status,
      lostReason: _status == 'LOST' ? _reason.text.trim() : null,
    ));
  }

  @override
  Widget build(BuildContext context) {
    final unchanged =
        _status == widget.current &&
        (_status != 'LOST' || _reason.text.trim() == (widget.lostReason ?? ''));
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.gutter,
          0,
          AppSpacing.gutter,
          AppSpacing.gutter,
        ),
        child: Form(
          key: _form,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Đổi bước', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: AppSpacing.s8),
              RadioGroup<String>(
                groupValue: _status,
                onChanged: (value) => setState(() => _status = value!),
                child: Column(
                  children: [
                    for (final MapEntry(key: status, value: label)
                        in customerStatusLabels.entries)
                      RadioListTile<String>(
                        value: status,
                        title: Text(label),
                        contentPadding: EdgeInsets.zero,
                      ),
                  ],
                ),
              ),
              if (_status == 'LOST') ...[
                const SizedBox(height: AppSpacing.s8),
                TextFormField(
                  controller: _reason,
                  autofocus: widget.current != 'LOST',
                  maxLines: 3,
                  inputFormatters: [LengthLimitingTextInputFormatter(1000)],
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(
                    labelText: 'Lý do mất khách',
                  ),
                  validator: (value) => (value ?? '').trim().isEmpty
                      ? 'Nhập lý do mất khách'
                      : null,
                ),
              ],
              const SizedBox(height: AppSpacing.s16),
              FilledButton(
                onPressed: unchanged ? null : _save,
                child: const Text('Lưu'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
