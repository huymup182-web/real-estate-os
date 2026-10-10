import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../../../core/widgets/error_retry.dart';
import '../../auth/presentation/session_controller.dart';

/// Độ dài mật khẩu, khớp backend `auth/password.ts`.
const passwordMinLength = 8;
const passwordMaxLength = 128;

/// Đổi mật khẩu bằng mã 6 số gửi tới email của tài khoản (`forgot-password` → `reset-password`). Đổi xong máy
/// chủ đăng xuất mọi thiết bị, nên app về màn đăng nhập.
class ChangePasswordScreen extends ConsumerStatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  ConsumerState<ChangePasswordScreen> createState() =>
      _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends ConsumerState<ChangePasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _code = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  var _obscure = true;
  var _sending = false;
  var _saving = false;
  int? _expiresInMinutes;
  String? _error;
  Map<String, String> _fieldErrors = const {};

  @override
  void dispose() {
    _code.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _send(String email) async {
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final seconds = await ref
          .read(authRepositoryProvider)
          .requestPasswordReset(email);
      if (mounted) {
        setState(() => _expiresInMinutes = (seconds / 60).ceil());
      }
    } on Object catch (error) {
      if (mounted) {
        setState(() => _error = ErrorRetry.messageOf(error));
      }
    } finally {
      if (mounted) {
        setState(() => _sending = false);
      }
    }
  }

  Future<void> _save(String email) async {
    setState(() => _fieldErrors = const {});
    if (!_form.currentState!.validate()) {
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    final messenger = ScaffoldMessenger.of(context);
    final session = ref.read(sessionProvider.notifier);
    try {
      await ref
          .read(authRepositoryProvider)
          .resetPassword(
            email: email,
            code: _code.text.trim(),
            newPassword: _password.text,
          );
    } on Object catch (error) {
      if (mounted) {
        final fields = error is ApiException
            ? error.fieldErrors
            : const <String, String>{};
        setState(() {
          _saving = false;
          // Lỗi gắn với ô nhập thì hiện dưới ô đó, không lặp lại bên dưới.
          _fieldErrors = fields;
          _error = fields.isEmpty ? ErrorRetry.messageOf(error) : null;
        });
      }
      return;
    }
    // Phiên này đã bị thu hồi trên máy chủ: xoá token trên máy, về màn đăng nhập.
    await session.signOut();
    messenger.showSnackBar(
      const SnackBar(
        content: Text(
          'Đã đổi mật khẩu. Vui lòng đăng nhập lại bằng mật khẩu mới.',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final email = ref.watch(sessionProvider).value?.user?.email;
    final theme = Theme.of(context);
    final muted = context.appColors.mutedForeground;
    final sent = _expiresInMinutes != null;
    return Scaffold(
      appBar: AppBar(title: const Text('Đổi mật khẩu')),
      body: email == null
          ? const SizedBox.shrink()
          : SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpacing.gutter),
              child: Form(
                key: _form,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      sent
                          ? 'Đã gửi mã 6 số tới $email. Mã có hiệu lực trong $_expiresInMinutes phút.'
                          : 'Mã xác nhận 6 số sẽ được gửi tới $email.',
                      style: theme.textTheme.bodyLarge,
                    ),
                    const SizedBox(height: AppSpacing.s4),
                    Text(
                      'Đổi xong, bạn sẽ được đăng xuất khỏi mọi thiết bị.',
                      style: theme.textTheme.bodySmall?.copyWith(color: muted),
                    ),
                    const SizedBox(height: AppSpacing.s16),
                    if (!sent)
                      FilledButton(
                        onPressed: _sending ? null : () => _send(email),
                        child: Text(_sending ? 'Đang gửi…' : 'Gửi mã'),
                      )
                    else ...[
                      TextFormField(
                        controller: _code,
                        autofocus: true,
                        keyboardType: TextInputType.number,
                        inputFormatters: [
                          FilteringTextInputFormatter.digitsOnly,
                          LengthLimitingTextInputFormatter(6),
                        ],
                        decoration: InputDecoration(
                          labelText: 'Mã xác nhận',
                          errorText: _fieldErrors['code'],
                        ),
                        validator: (value) =>
                            RegExp(r'^\d{6}$').hasMatch(value?.trim() ?? '')
                            ? null
                            : 'Nhập đủ 6 số trong email',
                      ),
                      const SizedBox(height: AppSpacing.s12),
                      TextFormField(
                        controller: _password,
                        obscureText: _obscure,
                        inputFormatters: [
                          LengthLimitingTextInputFormatter(passwordMaxLength),
                        ],
                        decoration: InputDecoration(
                          labelText: 'Mật khẩu mới',
                          helperText: 'Ít nhất $passwordMinLength ký tự',
                          errorText: _fieldErrors['newPassword'],
                          suffixIcon: IconButton(
                            tooltip: _obscure ? 'Hiện mật khẩu' : 'Ẩn mật khẩu',
                            icon: Icon(
                              _obscure
                                  ? Icons.visibility_outlined
                                  : Icons.visibility_off_outlined,
                            ),
                            onPressed: () =>
                                setState(() => _obscure = !_obscure),
                          ),
                        ),
                        validator: (value) =>
                            (value ?? '').length < passwordMinLength
                            ? 'Mật khẩu cần ít nhất $passwordMinLength ký tự'
                            : null,
                      ),
                      const SizedBox(height: AppSpacing.s12),
                      TextFormField(
                        controller: _confirm,
                        obscureText: _obscure,
                        inputFormatters: [
                          LengthLimitingTextInputFormatter(passwordMaxLength),
                        ],
                        decoration: const InputDecoration(
                          labelText: 'Nhập lại mật khẩu mới',
                        ),
                        validator: (value) => value == _password.text
                            ? null
                            : 'Hai mật khẩu chưa khớp',
                      ),
                      const SizedBox(height: AppSpacing.s16),
                      FilledButton(
                        onPressed: _saving ? null : () => _save(email),
                        child: Text(_saving ? 'Đang lưu…' : 'Đổi mật khẩu'),
                      ),
                      TextButton(
                        onPressed: _sending || _saving
                            ? null
                            : () => _send(email),
                        child: const Text('Gửi lại mã'),
                      ),
                    ],
                    if (_error case final error?) ...[
                      const SizedBox(height: AppSpacing.s12),
                      Text(
                        error,
                        style: TextStyle(color: theme.colorScheme.error),
                      ),
                    ],
                  ],
                ),
              ),
            ),
    );
  }
}
