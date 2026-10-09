import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/api_exception.dart';
import '../../../core/format/thousands_input_formatter.dart';
import '../../../core/format/vn_format.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/error_retry.dart';
import '../../locations/domain/location_option.dart';
import '../../locations/presentation/location_providers.dart';
import '../domain/property_draft.dart';
import '../domain/property_labels.dart';
import '../domain/property_query.dart' show parseDecimalInput;

const _maxSmallInt = 32767;
const _maxRoadWidth = 9999.99;

/// Form BĐS dùng chung cho tạo (TASK-122) và sửa (TASK-123). Bấm lưu: kiểm trên form, gọi [submit]; API báo
/// lỗi từng trường thì hiện tại trường đó. Lưu xong gọi [onSaved] với kết quả của [submit]. Đang có thay đổi
/// chưa lưu mà bấm quay lại thì hỏi trước khi bỏ.
class PropertyForm<T> extends ConsumerStatefulWidget {
  const PropertyForm({
    super.key,
    this.initial,
    required this.submitLabel,
    required this.submit,
    required this.onSaved,
    this.showStreetAddress = true,
  });

  final PropertyDraft? initial;

  /// Sửa BĐS mà không được xem địa chỉ chi tiết thì ẩn ô này (không gửi, giữ nguyên địa chỉ cũ).
  final bool showStreetAddress;
  final String submitLabel;
  final Future<T> Function(PropertyDraft draft) submit;
  final void Function(T result) onSaved;

  @override
  ConsumerState<PropertyForm<T>> createState() => _PropertyFormState<T>();
}

class _PropertyFormState<T> extends ConsumerState<PropertyForm<T>> {
  final _formKey = GlobalKey<FormState>();
  late final PropertyDraft? _initial = widget.initial;

  late final _title = TextEditingController(text: _initial?.title);
  late final _price = TextEditingController(
    text: _initial == null ? '' : vnNumber(_initial.price),
  );
  late final _area = TextEditingController(text: _decimal(_initial?.area));
  late final _bedrooms = TextEditingController(text: _int(_initial?.bedrooms));
  late final _bathrooms = TextEditingController(
    text: _int(_initial?.bathrooms),
  );
  late final _floors = TextEditingController(text: _int(_initial?.floors));
  late final _roadWidth = TextEditingController(
    text: _decimal(_initial?.roadWidth),
  );
  late final _street = TextEditingController(text: _initial?.streetAddress);
  late final _description = TextEditingController(text: _initial?.description);

  late String? _propertyType = _initial?.propertyType;
  late String? _direction = _initial?.direction;
  late String? _roadAccess = _initial?.roadAccess;
  late String? _legalStatus = _initial?.legalStatus;
  late String? _provinceId = _initial?.provinceId;
  late String? _wardId = _initial?.wardId;

  var _dirty = false;
  var _submitting = false;
  String? _error;
  var _serverErrors = <String, String>{};

  List<TextEditingController> get _controllers => [
    _title,
    _price,
    _area,
    _bedrooms,
    _bathrooms,
    _floors,
    _roadWidth,
    _street,
    _description,
  ];

  @override
  void dispose() {
    for (final controller in _controllers) {
      controller.dispose();
    }
    super.dispose();
  }

  /// Người dùng sửa trường [field]: bỏ lỗi API cũ của trường đó.
  void _changed(String field) {
    if (!_dirty || _serverErrors.containsKey(field)) {
      setState(() {
        _dirty = true;
        _serverErrors = {..._serverErrors}..remove(field);
      });
    }
  }

  PropertyDraft _draft() {
    String? text(TextEditingController controller) {
      final value = controller.text.trim();
      return value.isEmpty ? null : value;
    }

    int? integer(TextEditingController controller) =>
        text(controller) == null ? null : int.parse(controller.text.trim());

    return PropertyDraft(
      title: _title.text.trim(),
      description: text(_description),
      propertyType: _propertyType!,
      price: ThousandsInputFormatter.parse(_price.text)!,
      area: parseDecimalInput(_area.text)!,
      bedrooms: integer(_bedrooms),
      bathrooms: integer(_bathrooms),
      floors: integer(_floors),
      direction: _direction,
      roadWidth: parseDecimalInput(_roadWidth.text),
      roadAccess: _roadAccess,
      legalStatus: _legalStatus,
      provinceId: _provinceId!,
      wardId: _wardId!,
      streetAddress: text(_street),
    );
  }

  Future<void> _save() async {
    FocusScope.of(context).unfocus();
    setState(() {
      _error = null;
      _serverErrors = {};
    });
    // Danh mục tỉnh/phường chưa tải được thì chưa có ô để Form kiểm.
    if (!_formKey.currentState!.validate() ||
        _provinceId == null ||
        _wardId == null) {
      setState(() => _error = 'Vui lòng kiểm tra lại các ô báo lỗi.');
      return;
    }
    setState(() => _submitting = true);
    try {
      final result = await widget.submit(_draft());
      if (!mounted) {
        return;
      }
      setState(() {
        _dirty = false;
        _submitting = false;
      });
      widget.onSaved(result);
    } on Object catch (error) {
      if (!mounted) {
        return;
      }
      setState(() {
        _submitting = false;
        _serverErrors = error is ApiException ? error.fieldErrors : {};
        _error = ErrorRetry.messageOf(error);
      });
    }
  }

  Future<void> _confirmDiscard() async {
    final discard = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Bỏ thay đổi?'),
        content: const Text('Những gì bạn vừa nhập sẽ không được lưu.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Ở lại'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Bỏ'),
          ),
        ],
      ),
    );
    if (discard == true && mounted) {
      setState(() => _dirty = false);
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return PopScope(
      canPop: !_dirty && !_submitting,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && !_submitting) {
          _confirmDiscard();
        }
      },
      child: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.gutter),
          children: [
            const _Heading('Thông tin chính'),
            _TextField(
              controller: _title,
              label: 'Tiêu đề *',
              maxLength: 255,
              serverError: _serverErrors['title'],
              onChanged: () => _changed('title'),
              validator: (text) =>
                  text.isEmpty ? 'Vui lòng nhập tiêu đề' : null,
            ),
            _Dropdown(
              label: 'Loại BĐS *',
              value: _propertyType,
              options: propertyTypeLabels,
              serverError: _serverErrors['propertyType'],
              onChanged: (value) {
                _changed('propertyType');
                setState(() => _propertyType = value);
              },
              validator: (value) =>
                  value == null ? 'Vui lòng chọn loại BĐS' : null,
            ),
            _TextField(
              controller: _price,
              label: 'Giá (đồng) *',
              keyboardType: TextInputType.number,
              inputFormatters: const [ThousandsInputFormatter()],
              serverError: _serverErrors['price'],
              onChanged: () {
                _changed('price');
                setState(() {});
              },
              helperText: switch (ThousandsInputFormatter.parse(_price.text)) {
                final price? when price >= 1000000 =>
                  '= ${vnMoneyShort(price)}',
                _ => null,
              },
              validator: (text) => text.isEmpty ? 'Vui lòng nhập giá' : null,
            ),
            _TextField(
              controller: _area,
              label: 'Diện tích (m²) *',
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              inputFormatters: [_decimalChars],
              serverError: _serverErrors['area'],
              onChanged: () => _changed('area'),
              validator: (text) => text.isEmpty
                  ? 'Vui lòng nhập diện tích'
                  : _decimalError(text, min: 0.01),
            ),
            const _Heading('Vị trí'),
            _location(),
            if (widget.showStreetAddress)
              _TextField(
                controller: _street,
                label: 'Số nhà, tên đường',
                maxLength: 255,
                serverError: _serverErrors['streetAddress'],
                onChanged: () => _changed('streetAddress'),
              ),
            const _Heading('Đặc điểm'),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: _intField(_bedrooms, 'Phòng ngủ', 'bedrooms')),
                const SizedBox(width: AppSpacing.s12),
                Expanded(child: _intField(_bathrooms, 'WC', 'bathrooms')),
              ],
            ),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: _intField(_floors, 'Số tầng', 'floors')),
                const SizedBox(width: AppSpacing.s12),
                Expanded(
                  child: _TextField(
                    controller: _roadWidth,
                    label: 'Đường rộng (m)',
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    inputFormatters: [_decimalChars],
                    serverError: _serverErrors['roadWidth'],
                    onChanged: () => _changed('roadWidth'),
                    validator: (text) => text.isEmpty
                        ? null
                        : _decimalError(text, max: _maxRoadWidth),
                  ),
                ),
              ],
            ),
            _Dropdown(
              label: 'Hướng nhà',
              value: _direction,
              options: directionLabels,
              anyLabel: 'Chưa rõ',
              serverError: _serverErrors['direction'],
              onChanged: (value) {
                _changed('direction');
                setState(() => _direction = value);
              },
            ),
            _Dropdown(
              label: 'Đường vào',
              value: _roadAccess,
              options: roadAccessLabels,
              anyLabel: 'Chưa rõ',
              serverError: _serverErrors['roadAccess'],
              onChanged: (value) {
                _changed('roadAccess');
                setState(() => _roadAccess = value);
              },
            ),
            _Dropdown(
              label: 'Pháp lý',
              value: _legalStatus,
              options: legalStatusLabels,
              anyLabel: 'Chưa rõ',
              serverError: _serverErrors['legalStatus'],
              onChanged: (value) {
                _changed('legalStatus');
                setState(() => _legalStatus = value);
              },
            ),
            const _Heading('Mô tả'),
            _TextField(
              controller: _description,
              label: 'Mô tả',
              maxLength: 5000,
              minLines: 4,
              maxLines: 10,
              keyboardType: TextInputType.multiline,
              serverError: _serverErrors['description'],
              onChanged: () => _changed('description'),
            ),
            if (_error case final error?)
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.s12),
                child: Text(
                  error,
                  style: TextStyle(color: theme.colorScheme.error),
                ),
              ),
            FilledButton(
              onPressed: _submitting ? null : _save,
              child: _submitting
                  ? const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(widget.submitLabel),
            ),
          ],
        ),
      ),
    );
  }

  Widget _intField(
    TextEditingController controller,
    String label,
    String field,
  ) => _TextField(
    controller: controller,
    label: label,
    keyboardType: TextInputType.number,
    inputFormatters: [
      FilteringTextInputFormatter.digitsOnly,
      LengthLimitingTextInputFormatter(5),
    ],
    serverError: _serverErrors[field],
    onChanged: () => _changed(field),
    validator: (text) => text.isNotEmpty && int.parse(text) > _maxSmallInt
        ? 'Tối đa ${vnNumber(_maxSmallInt)}'
        : null,
  );

  Widget _location() {
    final provinces = ref.watch(provincesProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _LocationField(
          key: const ValueKey('province'),
          label: 'Tỉnh/thành *',
          options: provinces,
          value: _provinceId,
          serverError: _serverErrors['provinceId'],
          emptyError: 'Vui lòng chọn tỉnh/thành',
          onChanged: (value) {
            _changed('provinceId');
            setState(() {
              _provinceId = value;
              _wardId = null;
            });
          },
          onRetry: () => ref.invalidate(provincesProvider),
        ),
        if (_provinceId case final provinceId?)
          _LocationField(
            key: ValueKey('ward-$provinceId'),
            label: 'Phường/xã *',
            options: ref.watch(wardsProvider(provinceId)),
            value: _wardId,
            serverError: _serverErrors['wardId'],
            emptyError: 'Vui lòng chọn phường/xã',
            onChanged: (value) {
              _changed('wardId');
              setState(() => _wardId = value);
            },
            onRetry: () => ref.invalidate(wardsProvider(provinceId)),
          ),
      ],
    );
  }
}

final _decimalChars = FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'));

String? _decimalError(String text, {double? min, double? max}) {
  final double? value;
  try {
    value = parseDecimalInput(text);
  } on FormatException {
    return 'Nhập số, tối đa 2 chữ số sau dấu phẩy';
  }
  if (value == null) {
    return null;
  }
  if (min != null && value < min) {
    return 'Phải lớn hơn 0';
  }
  if (max != null && value > max) {
    return 'Tối đa ${vnDecimal(max)}';
  }
  return null;
}

String _int(int? value) => value?.toString() ?? '';

String _decimal(double? value) => value == null ? '' : vnDecimal(value);

class _Heading extends StatelessWidget {
  const _Heading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: AppSpacing.s8, bottom: AppSpacing.s12),
    child: Text(text, style: Theme.of(context).textTheme.titleMedium),
  );
}

class _TextField extends StatelessWidget {
  const _TextField({
    required this.controller,
    required this.label,
    required this.onChanged,
    this.serverError,
    this.validator,
    this.helperText,
    this.keyboardType,
    this.inputFormatters,
    this.maxLength,
    this.minLines,
    this.maxLines = 1,
  });

  final TextEditingController controller;
  final String label;
  final VoidCallback onChanged;
  final String? serverError;
  final String? Function(String text)? validator;
  final String? helperText;
  final TextInputType? keyboardType;
  final List<TextInputFormatter>? inputFormatters;
  final int? maxLength;
  final int? minLines;
  final int? maxLines;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: AppSpacing.s12),
    child: TextFormField(
      controller: controller,
      decoration: InputDecoration(
        labelText: label,
        helperText: helperText,
        errorMaxLines: 3,
        counterText: '',
        alignLabelWithHint: (maxLines ?? 2) > 1,
      ),
      keyboardType: keyboardType,
      inputFormatters: [
        ...?inputFormatters,
        if (maxLength != null) LengthLimitingTextInputFormatter(maxLength),
      ],
      minLines: minLines,
      maxLines: maxLines,
      forceErrorText: serverError,
      onChanged: (_) => onChanged(),
      validator: validator == null
          ? null
          : (text) => validator!((text ?? '').trim()),
    ),
  );
}

class _Dropdown extends StatelessWidget {
  const _Dropdown({
    required this.label,
    required this.value,
    required this.options,
    required this.onChanged,
    this.anyLabel,
    this.serverError,
    this.validator,
  });

  final String label;
  final String? value;
  final Map<String, String> options;
  final ValueChanged<String?> onChanged;

  /// Có thì thêm lựa chọn "không chọn" với nhãn này.
  final String? anyLabel;
  final String? serverError;
  final String? Function(String? value)? validator;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: AppSpacing.s12),
    child: DropdownButtonFormField<String?>(
      initialValue: value,
      isExpanded: true,
      decoration: InputDecoration(labelText: label, errorMaxLines: 3),
      items: [
        if (anyLabel case final any?)
          DropdownMenuItem(value: null, child: Text(any)),
        for (final MapEntry(:key, value: text) in options.entries)
          DropdownMenuItem(value: key, child: Text(text)),
      ],
      forceErrorText: serverError,
      onChanged: onChanged,
      validator: validator,
    ),
  );
}

class _LocationField extends StatelessWidget {
  const _LocationField({
    super.key,
    required this.label,
    required this.options,
    required this.value,
    required this.emptyError,
    required this.onChanged,
    required this.onRetry,
    this.serverError,
  });

  final String label;
  final AsyncValue<List<LocationOption>> options;
  final String? value;
  final String emptyError;
  final ValueChanged<String?> onChanged;
  final VoidCallback onRetry;
  final String? serverError;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: AppSpacing.s12),
    child: switch (options) {
      AsyncData(value: final items) => DropdownButtonFormField<String?>(
        initialValue: items.any((item) => item.id == value) ? value : null,
        isExpanded: true,
        decoration: InputDecoration(labelText: label, errorMaxLines: 3),
        hint: Text(
          'Chọn',
          style: TextStyle(color: context.appColors.mutedForeground),
        ),
        items: [
          for (final item in items)
            DropdownMenuItem(
              value: item.id,
              child: Text(item.name, overflow: TextOverflow.ellipsis),
            ),
        ],
        forceErrorText: serverError,
        onChanged: onChanged,
        validator: (value) => value == null ? emptyError : null,
      ),
      AsyncError(:final error) => ErrorRetry(error: error, onRetry: onRetry),
      _ => const Padding(
        padding: EdgeInsets.symmetric(vertical: AppSpacing.s16),
        child: LinearProgressIndicator(),
      ),
    },
  );
}
