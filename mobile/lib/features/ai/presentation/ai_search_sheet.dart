import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/error_retry.dart';
import '../domain/ai_search.dart';
import 'ai_providers.dart';

/// Giới hạn độ dài câu tìm của API (`backend/src/ai/dto/ai-property-search.dto.ts`).
const aiSearchQueryMax = 500;

/// Mở ô tìm BĐS bằng câu tự nhiên (TASK-134). Trả kết quả khi AI đã đổi câu thành bộ lọc, `null` khi đóng.
Future<AiPropertySearch?> showAiSearchSheet(BuildContext context) =>
    showModalBottomSheet<AiPropertySearch>(
      context: context,
      isScrollControlled: true,
      useRootNavigator: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (context) => const AiSearchSheet(),
    );

class AiSearchSheet extends ConsumerStatefulWidget {
  const AiSearchSheet({super.key});

  @override
  ConsumerState<AiSearchSheet> createState() => _AiSearchSheetState();
}

class _AiSearchSheetState extends ConsumerState<AiSearchSheet> {
  final _controller = TextEditingController();
  var _loading = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final query = _controller.text.trim().replaceAll(RegExp(r'\s+'), ' ');
    if (query.length < 2) {
      setState(
        () => _error = 'Nhập điều kiện cần tìm, ví dụ giá, khu vực, số phòng.',
      );
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    final navigator = Navigator.of(context);
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      final result = await container
          .read(aiRepositoryProvider)
          .propertySearch(query);
      if (mounted) {
        navigator.pop(result);
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = ErrorRetry.messageOf(error);
        });
      }
    } finally {
      // Lượt AI đã dùng (kể cả khi lỗi) thay đổi số lượt còn lại.
      container.invalidate(aiStatusProvider);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final remaining = ref.watch(aiStatusProvider).value?.remaining;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.gutter,
        0,
        AppSpacing.gutter,
        MediaQuery.viewInsetsOf(context).bottom + AppSpacing.gutter,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Tìm bằng AI', style: theme.textTheme.titleLarge),
          const SizedBox(height: AppSpacing.s4),
          Text(
            'Gõ như khi nói với đồng nghiệp. AI chỉ đổi câu thành bộ lọc, kết quả vẫn lấy từ kho BĐS của công ty.',
            style: theme.textTheme.bodyMedium?.copyWith(
              color: context.appColors.mutedForeground,
            ),
          ),
          const SizedBox(height: AppSpacing.s12),
          TextField(
            key: const Key('ai-search-input'),
            controller: _controller,
            autofocus: true,
            enabled: !_loading,
            minLines: 2,
            maxLines: 4,
            textInputAction: TextInputAction.search,
            onSubmitted: (_) => _submit(),
            inputFormatters: [
              LengthLimitingTextInputFormatter(aiSearchQueryMax),
            ],
            decoration: InputDecoration(
              hintText: 'Ví dụ: nhà khoảng 5 tỷ ở Nha Trang, 3 phòng ngủ, ô tô vào được',
              errorText: _error,
              errorMaxLines: 3,
            ),
          ),
          if (remaining != null) ...[
            const SizedBox(height: AppSpacing.s8),
            Text(
              'Còn $remaining lượt AI trong 24 giờ.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: context.appColors.mutedForeground,
              ),
            ),
          ],
          const SizedBox(height: AppSpacing.s12),
          FilledButton.icon(
            onPressed: _loading || remaining == 0 ? null : _submit,
            icon: _loading
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.auto_awesome),
            label: Text(_loading ? 'AI đang đọc câu tìm…' : 'Tìm'),
          ),
        ],
      ),
    );
  }
}
