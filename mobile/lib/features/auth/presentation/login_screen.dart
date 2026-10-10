import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_tokens.dart';
import '../domain/login_identifier.dart';
import 'session_controller.dart';

/// Đăng nhập bằng email hoặc số điện thoại và mật khẩu. Thành công thì router tự chuyển vào trang chủ.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _identifier = TextEditingController();
  final _password = TextEditingController();
  bool _obscure = true;
  bool _submitting = false;
  String? _error;
  Map<String, String> _fieldErrors = const {};

  @override
  void dispose() {
    _identifier.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_submitting) {
      return;
    }
    setState(() {
      _error = null;
      _fieldErrors = const {};
    });
    if (!_formKey.currentState!.validate()) {
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() => _submitting = true);
    try {
      await ref
          .read(sessionProvider.notifier)
          .signIn(
            identifier: normalizeLoginIdentifier(_identifier.text)!,
            password: _password.text,
          );
    } on ApiException catch (error) {
      if (mounted) {
        setState(() {
          _error = error.message;
          _fieldErrors = error.fieldErrors;
        });
      }
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.s24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: AutofillGroup(
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Align(
                        alignment: Alignment.centerLeft,
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            color: scheme.primary,
                            borderRadius: const BorderRadius.all(AppRadius.xl),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(AppSpacing.s12),
                            child: Icon(
                              Icons.apartment,
                              size: 32,
                              color: scheme.onPrimary,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: AppSpacing.s24),
                      Text('Đăng nhập', style: theme.textTheme.headlineMedium),
                      const SizedBox(height: AppSpacing.s4),
                      Text(
                        'Dùng tài khoản công ty cấp cho bạn.',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: context.appColors.mutedForeground,
                        ),
                      ),
                      const SizedBox(height: AppSpacing.s24),
                      TextFormField(
                        controller: _identifier,
                        decoration: InputDecoration(
                          labelText: 'Email hoặc số điện thoại',
                          hintText: 'vd 0901234567',
                          prefixIcon: const Icon(Icons.person_outline),
                          errorText: _fieldErrors['identifier'],
                        ),
                        keyboardType: TextInputType.emailAddress,
                        autocorrect: false,
                        textInputAction: TextInputAction.next,
                        autofillHints: const [
                          AutofillHints.username,
                          AutofillHints.email,
                          AutofillHints.telephoneNumber,
                        ],
                        enabled: !_submitting,
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) {
                            return 'Nhập email hoặc số điện thoại';
                          }
                          return normalizeLoginIdentifier(value) == null
                              ? 'Email hoặc số điện thoại chưa đúng'
                              : null;
                        },
                      ),
                      const SizedBox(height: AppSpacing.s16),
                      TextFormField(
                        controller: _password,
                        decoration: InputDecoration(
                          labelText: 'Mật khẩu',
                          prefixIcon: const Icon(Icons.lock_outline),
                          errorText: _fieldErrors['password'],
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
                        obscureText: _obscure,
                        autocorrect: false,
                        enableSuggestions: false,
                        textInputAction: TextInputAction.done,
                        autofillHints: const [AutofillHints.password],
                        enabled: !_submitting,
                        onFieldSubmitted: (_) => _submit(),
                        validator: (value) => value == null || value.isEmpty
                            ? 'Nhập mật khẩu'
                            : null,
                      ),
                      if (_error != null) ...[
                        const SizedBox(height: AppSpacing.s16),
                        Semantics(
                          liveRegion: true,
                          child: Text(
                            _error!,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: scheme.error,
                            ),
                          ),
                        ),
                      ],
                      const SizedBox(height: AppSpacing.s24),
                      FilledButton(
                        onPressed: _submitting ? null : _submit,
                        child: _submitting
                            ? SizedBox.square(
                                dimension: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: scheme.onSurface,
                                ),
                              )
                            : const Text('Đăng nhập'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
