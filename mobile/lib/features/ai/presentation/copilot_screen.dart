import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/format/vn_format.dart';
import '../../../core/router/app_router.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/error_retry.dart';
import '../../customers/presentation/customer_card.dart';
import '../domain/ai_copilot.dart';
import 'ai_providers.dart';

/// Số lượt hội thoại tối đa gửi backend (`messages` tối đa 20, bắt đầu bằng câu hỏi).
const copilotHistoryLimit = 19;

/// Chat với AI Copilot (TASK-143, MASTER_PLAN mục 20). Mở từ trang chủ, chi tiết khách hoặc BĐS ([context]).
/// Hội thoại chỉ nằm trên màn hình này; đóng màn hình là hết.
class CopilotScreen extends ConsumerStatefulWidget {
  const CopilotScreen({super.key, this.context = const CopilotContext()});

  final CopilotContext context;

  @override
  ConsumerState<CopilotScreen> createState() => _CopilotScreenState();
}

class _CopilotScreenState extends ConsumerState<CopilotScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final _turns = <CopilotTurn>[];
  bool _sending = false;
  Object? _error;

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  List<String> get _suggestions {
    final context = widget.context;
    if (context.customerId != null) {
      return copilotSuggestions.customer;
    }
    if (context.propertyId != null) {
      return copilotSuggestions.property;
    }
    return copilotSuggestions.general;
  }

  Future<void> _send(String text) async {
    final question = text.trim();
    if (question.isEmpty || _sending) {
      return;
    }
    setState(() {
      _turns.add(CopilotTurn.user(question));
      _input.clear();
      _sending = true;
      _error = null;
    });
    _scrollToEnd();
    final history = _turns.length > copilotHistoryLimit
        ? _turns.sublist(_turns.length - copilotHistoryLimit)
        : List.of(_turns);
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      final reply = await container
          .read(aiRepositoryProvider)
          .copilot(history, widget.context);
      if (mounted) {
        setState(() => _turns.add(reply));
      }
    } catch (error) {
      // Bỏ câu hỏi lỗi khỏi hội thoại, trả lại ô nhập để gửi lại.
      if (mounted) {
        setState(() {
          _turns.removeLast();
          _input.text = question;
          _error = error;
        });
      }
    } finally {
      if (mounted) {
        setState(() => _sending = false);
        _scrollToEnd();
      }
      container.invalidate(aiStatusProvider);
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: AppDurations.normal,
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = context.appColors.mutedForeground;
    final remaining = ref.watch(aiStatusProvider).value?.remaining;
    final subject = widget.context.customerId != null
        ? 'Đang hỏi về khách này'
        : widget.context.propertyId != null
        ? 'Đang hỏi về BĐS này'
        : null;
    final error = _error;
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Copilot AI'),
            if (subject != null)
              Text(
                subject,
                style: theme.textTheme.bodySmall?.copyWith(color: muted),
              ),
          ],
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              controller: _scroll,
              padding: const EdgeInsets.all(AppSpacing.gutter),
              children: [
                if (_turns.isEmpty) ...[
                  Text(
                    'Hỏi Copilot về BĐS và khách bạn được xem. Copilot tự tra dữ liệu trong app; tên, số điện thoại của khách không gửi cho AI.',
                    style: theme.textTheme.bodyMedium?.copyWith(color: muted),
                  ),
                  const SizedBox(height: AppSpacing.s12),
                  Wrap(
                    spacing: AppSpacing.s8,
                    runSpacing: AppSpacing.s8,
                    children: [
                      for (final suggestion in _suggestions)
                        ActionChip(
                          label: Text(suggestion),
                          onPressed: _sending ? null : () => _send(suggestion),
                        ),
                    ],
                  ),
                ],
                for (final turn in _turns) _TurnView(turn: turn),
                if (_sending)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: AppSpacing.s12),
                    child: Row(
                      children: [
                        SizedBox.square(
                          dimension: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                        SizedBox(width: AppSpacing.s12),
                        Text('Copilot đang tra dữ liệu…'),
                      ],
                    ),
                  ),
                if (error != null)
                  ErrorRetry(error: error, onRetry: () => _send(_input.text)),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.gutter,
                AppSpacing.s8,
                AppSpacing.s8,
                AppSpacing.s8,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          key: const Key('copilot-input'),
                          controller: _input,
                          enabled: !_sending,
                          minLines: 1,
                          maxLines: 4,
                          maxLength: 1000,
                          textInputAction: TextInputAction.send,
                          onSubmitted: _send,
                          decoration: const InputDecoration(
                            hintText: 'Hỏi Copilot…',
                            counterText: '',
                          ),
                        ),
                      ),
                      IconButton(
                        tooltip: 'Gửi',
                        icon: const Icon(Icons.send),
                        onPressed: _sending ? null : () => _send(_input.text),
                      ),
                    ],
                  ),
                  if (remaining != null)
                    Padding(
                      padding: const EdgeInsets.only(top: AppSpacing.s4),
                      child: Text(
                        'Còn $remaining lượt AI trong 24 giờ. Mỗi câu hỏi dùng 1–4 lượt.',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: muted,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _TurnView extends StatelessWidget {
  const _TurnView({required this.turn});

  final CopilotTurn turn;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final bubble = Container(
      constraints: const BoxConstraints(maxWidth: 560),
      padding: const EdgeInsets.all(AppSpacing.s12),
      decoration: BoxDecoration(
        color: turn.fromUser ? scheme.primary : scheme.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(AppRadius.xl),
      ),
      child: turn.fromUser
          ? Text(turn.content, style: TextStyle(color: scheme.onPrimary))
          : SelectableText(turn.content),
    );
    if (turn.fromUser) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.s4),
        child: Align(alignment: Alignment.centerRight, child: bubble),
      );
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.s4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          bubble,
          Row(
            children: [
              IconButton(
                tooltip: 'Sao chép câu trả lời',
                icon: const Icon(Icons.copy_outlined, size: 18),
                onPressed: () async {
                  final messenger = ScaffoldMessenger.of(context);
                  await Clipboard.setData(ClipboardData(text: turn.content));
                  messenger.showSnackBar(
                    const SnackBar(content: Text('Đã sao chép câu trả lời.')),
                  );
                },
              ),
            ],
          ),
          for (final customer in turn.customers)
            ListTile(
              key: Key('copilot-customer-${customer.id}'),
              contentPadding: EdgeInsets.zero,
              leading: CircleAvatar(child: Text(customer.ref)),
              title: Text(customer.fullName),
              trailing: CustomerStatusBadge(status: customer.status),
              onTap: () => context.push(AppRoutes.customerDetail(customer.id)),
            ),
          for (final property in turn.properties)
            ListTile(
              key: Key('copilot-property-${property.id}'),
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.home_work_outlined),
              title: Text('${property.code} · ${property.title}'),
              subtitle: Text(
                '${vnMoneyShort(property.price)} · ${vnDecimal(property.area)} m²',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push(AppRoutes.propertyDetail(property.id)),
            ),
        ],
      ),
    );
  }
}
