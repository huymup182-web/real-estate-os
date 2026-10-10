import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Ô tìm kiếm: gõ xong [debounce] mới gọi [onSearch]; bấm tìm trên bàn phím thì gọi ngay; nút ✕ xoá và tìm lại.
class DebouncedSearchField extends StatefulWidget {
  const DebouncedSearchField({
    super.key,
    required this.initial,
    required this.hint,
    required this.maxLength,
    required this.onSearch,
  });

  static const debounce = Duration(milliseconds: 400);

  final String initial;
  final String hint;
  final int maxLength;
  final ValueChanged<String> onSearch;

  @override
  State<DebouncedSearchField> createState() => _DebouncedSearchFieldState();
}

class _DebouncedSearchFieldState extends State<DebouncedSearchField> {
  late final _controller = TextEditingController(text: widget.initial);
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _apply() {
    _timer?.cancel();
    widget.onSearch(_controller.text);
  }

  void _onChanged(String _) {
    _timer?.cancel();
    _timer = Timer(DebouncedSearchField.debounce, _apply);
    setState(() {});
  }

  void _clear() {
    _controller.clear();
    _apply();
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _controller,
      onChanged: _onChanged,
      onSubmitted: (_) => _apply(),
      textInputAction: TextInputAction.search,
      inputFormatters: [LengthLimitingTextInputFormatter(widget.maxLength)],
      decoration: InputDecoration(
        hintText: widget.hint,
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
