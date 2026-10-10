import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/error_retry.dart';
import '../../locations/domain/location_option.dart';
import '../../locations/presentation/location_providers.dart';
import '../domain/property_labels.dart';
import '../domain/property_query.dart';

/// Mở bộ lọc BĐS. Trả về bộ lọc mới khi bấm "Áp dụng" (từ khoá giữ nguyên ở nơi gọi), `null` khi đóng.
Future<PropertyQuery?> showPropertyFilterSheet(
  BuildContext context,
  PropertyQuery current,
) => showModalBottomSheet<PropertyQuery>(
  context: context,
  isScrollControlled: true,
  // Phủ cả thanh tab dưới cho bảng lọc đủ cao.
  useRootNavigator: true,
  useSafeArea: true,
  showDragHandle: true,
  builder: (context) => FractionallySizedBox(
    heightFactor: 0.92,
    child: PropertyFilterSheet(initial: current),
  ),
);

/// Bộ lọc và sắp xếp: loại, giá (tỷ), diện tích (m²), tỉnh/thành, phường/xã, phòng ngủ, pháp lý, hướng, đường vào.
class PropertyFilterSheet extends ConsumerStatefulWidget {
  const PropertyFilterSheet({super.key, required this.initial});

  final PropertyQuery initial;

  @override
  ConsumerState<PropertyFilterSheet> createState() =>
      _PropertyFilterSheetState();
}

const _billion = 1000000000;
const _priceDecimals = 3;
const _areaDecimals = 2;

class _PropertyFilterSheetState extends ConsumerState<PropertyFilterSheet> {
  // "Xoá lọc" đổi các key này để dựng lại các ô (xoá lỗi đang hiện, dropdown về giá trị mới).
  var _formKey = GlobalKey<FormState>();
  late String? _sort = widget.initial.sort;
  late final Set<String> _types = {...widget.initial.propertyTypes};
  late final _priceMin = TextEditingController(
    text: _decimalText(widget.initial.priceMin, _billion, _priceDecimals),
  );
  late final _priceMax = TextEditingController(
    text: _decimalText(widget.initial.priceMax, _billion, _priceDecimals),
  );
  late final _areaMin = TextEditingController(
    text: _decimalText(widget.initial.areaMin, 1, _areaDecimals),
  );
  late final _areaMax = TextEditingController(
    text: _decimalText(widget.initial.areaMax, 1, _areaDecimals),
  );
  late String? _provinceId = widget.initial.provinceId;
  late String? _wardId = widget.initial.wardId;
  late int? _bedroomsMin = widget.initial.bedroomsMin;
  late final Set<String> _legal = {...widget.initial.legalStatuses};
  late final Set<String> _directions = {...widget.initial.directions};
  late final Set<String> _roads = {...widget.initial.roadAccesses};
  var _priceKey = GlobalKey();
  var _areaKey = GlobalKey();

  @override
  void dispose() {
    for (final controller in [_priceMin, _priceMax, _areaMin, _areaMax]) {
      controller.dispose();
    }
    super.dispose();
  }

  void _reset() {
    setState(() {
      _sort = null;
      _types.clear();
      for (final controller in [_priceMin, _priceMax, _areaMin, _areaMax]) {
        controller.clear();
      }
      _provinceId = null;
      _wardId = null;
      _bedroomsMin = null;
      _legal.clear();
      _directions.clear();
      _roads.clear();
      _formKey = GlobalKey<FormState>();
      _priceKey = GlobalKey();
      _areaKey = GlobalKey();
    });
  }

  void _apply() {
    if (!_formKey.currentState!.validate()) {
      // Cuộn tới ô đang báo lỗi (giá hoặc diện tích).
      final invalid = _rangeInvalid(_priceMin, _priceMax, _priceDecimals)
          ? _priceKey
          : _areaKey;
      if (invalid.currentContext case final context?) {
        Scrollable.ensureVisible(context, duration: AppDurations.fast);
      }
      return;
    }
    int? price(TextEditingController controller) {
      final value = parseDecimalInput(
        controller.text,
        decimals: _priceDecimals,
      );
      return value == null ? null : (value * _billion).round();
    }

    Navigator.of(context).pop(
      PropertyQuery(
        sort: _sort,
        propertyTypes: {..._types},
        priceMin: price(_priceMin),
        priceMax: price(_priceMax),
        areaMin: parseDecimalInput(_areaMin.text),
        areaMax: parseDecimalInput(_areaMax.text),
        provinceId: _provinceId,
        wardId: _wardId,
        bedroomsMin: _bedroomsMin,
        legalStatuses: {..._legal},
        directions: {..._directions},
        roadAccesses: {..._roads},
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.gutter),
          child: Row(
            children: [
              Expanded(
                child: Text('Bộ lọc', style: theme.textTheme.titleLarge),
              ),
              TextButton(onPressed: _reset, child: const Text('Xoá lọc')),
            ],
          ),
        ),
        Expanded(
          child: Form(
            key: _formKey,
            // Không dùng ListView: ô nằm ngoài màn hình vẫn phải còn để Form kiểm tra được.
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.gutter),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _Section(
                    title: 'Sắp xếp',
                    child: _Chips(
                      options: {
                        null: widget.initial.keyword.isEmpty
                            ? 'Mới nhất'
                            : 'Phù hợp nhất',
                        for (final entry in propertySortLabels.entries)
                          if (entry.key != 'newest' ||
                              widget.initial.keyword.isNotEmpty)
                            entry.key: entry.value,
                      },
                      isSelected: (value) => _sort == value,
                      onSelected: (value) => setState(() => _sort = value),
                    ),
                  ),
                  _Section(
                    title: 'Loại BĐS',
                    child: _Chips(
                      options: propertyTypeLabels,
                      isSelected: _types.contains,
                      onSelected: (value) =>
                          setState(() => _toggle(_types, value)),
                    ),
                  ),
                  _Section(
                    key: _priceKey,
                    title: 'Giá (tỷ đồng)',
                    child: _RangeFields(
                      min: _priceMin,
                      max: _priceMax,
                      decimals: _priceDecimals,
                      rangeError: 'Giá đến phải từ giá từ trở lên',
                    ),
                  ),
                  _Section(
                    key: _areaKey,
                    title: 'Diện tích (m²)',
                    child: _RangeFields(
                      min: _areaMin,
                      max: _areaMax,
                      decimals: _areaDecimals,
                      rangeError: 'Diện tích đến phải từ diện tích từ trở lên',
                    ),
                  ),
                  _Section(title: 'Khu vực', child: _location()),
                  _Section(
                    title: 'Phòng ngủ',
                    child: _Chips(
                      options: {
                        null: 'Bất kỳ',
                        for (var count = 1; count <= 5; count++)
                          count: '$count+',
                      },
                      isSelected: (value) => _bedroomsMin == value,
                      onSelected: (value) =>
                          setState(() => _bedroomsMin = value),
                    ),
                  ),
                  _Section(
                    title: 'Pháp lý',
                    child: _Chips(
                      options: legalStatusLabels,
                      isSelected: _legal.contains,
                      onSelected: (value) =>
                          setState(() => _toggle(_legal, value)),
                    ),
                  ),
                  _Section(
                    title: 'Hướng nhà',
                    child: _Chips(
                      options: directionLabels,
                      isSelected: _directions.contains,
                      onSelected: (value) =>
                          setState(() => _toggle(_directions, value)),
                    ),
                  ),
                  _Section(
                    title: 'Đường vào',
                    child: _Chips(
                      options: roadAccessLabels,
                      isSelected: _roads.contains,
                      onSelected: (value) =>
                          setState(() => _toggle(_roads, value)),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(AppSpacing.gutter),
          child: SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _apply,
              child: const Text('Áp dụng'),
            ),
          ),
        ),
      ],
    );
  }

  Widget _location() {
    final provinces = ref.watch(provincesProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _LocationDropdown(
          key: const ValueKey('province'),
          label: 'Tỉnh/thành',
          anyLabel: 'Mọi tỉnh/thành',
          options: provinces,
          value: _provinceId,
          onChanged: (value) => setState(() {
            _provinceId = value;
            _wardId = null;
          }),
          onRetry: () => ref.invalidate(provincesProvider),
        ),
        if (_provinceId case final provinceId?) ...[
          const SizedBox(height: AppSpacing.s12),
          _LocationDropdown(
            key: ValueKey('ward-$provinceId'),
            label: 'Phường/xã',
            anyLabel: 'Mọi phường/xã',
            options: ref.watch(wardsProvider(provinceId)),
            value: _wardId,
            onChanged: (value) => setState(() => _wardId = value),
            onRetry: () => ref.invalidate(wardsProvider(provinceId)),
          ),
        ],
      ],
    );
  }
}

void _toggle(Set<String> values, String value) {
  if (!values.remove(value)) {
    values.add(value);
  }
}

/// Số đã lưu → chữ trong ô ("3,5"), chia [unit] (tỷ: 10^9), tối đa [decimals] chữ số thập phân.
String _decimalText(num? value, int unit, int decimals) {
  if (value == null) {
    return '';
  }
  var text = (value / unit).toStringAsFixed(decimals);
  text = text.replaceFirst(RegExp(r'\.?0+$'), '');
  return text.replaceAll('.', ',');
}

bool _rangeInvalid(
  TextEditingController min,
  TextEditingController max,
  int decimals,
) {
  try {
    final from = parseDecimalInput(min.text, decimals: decimals);
    final to = parseDecimalInput(max.text, decimals: decimals);
    return from != null && to != null && to < from;
  } on FormatException {
    return true;
  }
}

class _Section extends StatelessWidget {
  const _Section({super.key, required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: AppSpacing.s24),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: AppSpacing.s8),
        child,
      ],
    ),
  );
}

class _Chips<T> extends StatelessWidget {
  const _Chips({
    required this.options,
    required this.isSelected,
    required this.onSelected,
  });

  final Map<T, String> options;
  final bool Function(T value) isSelected;
  final void Function(T value) onSelected;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: AppSpacing.s8,
    runSpacing: AppSpacing.s8,
    children: [
      for (final MapEntry(:key, :value) in options.entries)
        FilterChip(
          label: Text(value),
          selected: isSelected(key),
          onSelected: (_) => onSelected(key),
        ),
    ],
  );
}

/// Hai ô "Từ" – "Đến"; trống là không giới hạn.
class _RangeFields extends StatelessWidget {
  const _RangeFields({
    required this.min,
    required this.max,
    required this.decimals,
    required this.rangeError,
  });

  final TextEditingController min;
  final TextEditingController max;
  final int decimals;
  final String rangeError;

  String? _formatError(String? text) {
    try {
      parseDecimalInput(text ?? '', decimals: decimals);
      return null;
    } on FormatException {
      return 'Nhập số, tối đa $decimals chữ số sau dấu phẩy';
    }
  }

  @override
  Widget build(BuildContext context) {
    Widget field(
      TextEditingController controller,
      String label, {
      String? Function(String?)? extra,
    }) => Expanded(
      child: TextFormField(
        controller: controller,
        decoration: InputDecoration(labelText: label, errorMaxLines: 3),
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        inputFormatters: [
          FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
          LengthLimitingTextInputFormatter(14),
        ],
        validator: (text) => _formatError(text) ?? extra?.call(text),
      ),
    );

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        field(min, 'Từ'),
        const SizedBox(width: AppSpacing.s12),
        field(
          max,
          'Đến',
          extra: (text) {
            final from = _parseOrNull(min.text);
            final to = _parseOrNull(text ?? '');
            return from != null && to != null && to < from ? rangeError : null;
          },
        ),
      ],
    );
  }

  double? _parseOrNull(String text) {
    try {
      return parseDecimalInput(text, decimals: decimals);
    } on FormatException {
      return null;
    }
  }
}

class _LocationDropdown extends StatelessWidget {
  const _LocationDropdown({
    super.key,
    required this.label,
    required this.anyLabel,
    required this.options,
    required this.value,
    required this.onChanged,
    required this.onRetry,
  });

  final String label;
  final String anyLabel;
  final AsyncValue<List<LocationOption>> options;
  final String? value;
  final ValueChanged<String?> onChanged;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => switch (options) {
    AsyncData(value: final items) => DropdownButtonFormField<String?>(
      initialValue: items.any((item) => item.id == value) ? value : null,
      isExpanded: true,
      decoration: InputDecoration(labelText: label),
      items: [
        DropdownMenuItem(value: null, child: Text(anyLabel)),
        for (final item in items)
          DropdownMenuItem(
            value: item.id,
            child: Text(item.name, overflow: TextOverflow.ellipsis),
          ),
      ],
      onChanged: onChanged,
    ),
    AsyncError(:final error) => ErrorRetry(error: error, onRetry: onRetry),
    _ => const Padding(
      padding: EdgeInsets.symmetric(vertical: AppSpacing.s16),
      child: LinearProgressIndicator(),
    ),
  };
}
