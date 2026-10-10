import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/property_query.dart';
import 'property_list_controller.dart';

/// Ô tìm BĐS theo mã, tiêu đề, mô tả, địa chỉ. Gõ xong [debounce] mới tìm; bấm tìm trên bàn phím thì tìm ngay.
class PropertySearchField extends ConsumerStatefulWidget {
  const PropertySearchField({super.key});

  static const debounce = Duration(milliseconds: 400);

  @override
  ConsumerState<PropertySearchField> createState() =>
      _PropertySearchFieldState();
}

class _PropertySearchFieldState extends ConsumerState<PropertySearchField> {
  late final _controller = TextEditingController(
    text: ref.read(propertyQueryProvider).keyword,
  );
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _apply() {
    _timer?.cancel();
    ref.read(propertyQueryProvider.notifier).setKeyword(_controller.text);
  }

  void _onChanged(String _) {
    _timer?.cancel();
    _timer = Timer(PropertySearchField.debounce, _apply);
    setState(() {});
  }

  void _clear() {
    _controller.clear();
    _apply();
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    // Từ khoá đổi từ nơi khác (tìm bằng AI) thì hiện theo; đang gõ dở (chưa tới lúc tìm) thì không ghi đè.
    ref.listen(propertyQueryProvider.select((query) => query.keyword), (
      _,
      keyword,
    ) {
      if (normalizeKeyword(_controller.text) != keyword) {
        _timer?.cancel();
        _controller.text = keyword;
        setState(() {});
      }
    });
    return TextField(
      controller: _controller,
      onChanged: _onChanged,
      onSubmitted: (_) => _apply(),
      textInputAction: TextInputAction.search,
      inputFormatters: [
        LengthLimitingTextInputFormatter(PropertyQuery.maxKeywordLength),
      ],
      decoration: InputDecoration(
        hintText: 'Tìm theo mã, tiêu đề, địa chỉ',
        prefixIcon: const Icon(Icons.search),
        suffixIcon: _controller.text.isEmpty
            ? null
            : IconButton(
                tooltip: 'Xoá tìm kiếm',
                icon: const Icon(Icons.close),
                onPressed: _clear,
              ),
      ),
    );
  }
}
