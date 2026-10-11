import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/api_exception.dart';
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

  void _accountHelp({required bool registration}) {
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(registration ? 'Đăng ký tài khoản mới' : 'Quên mật khẩu?'),
        content: Text(
          registration
              ? 'Tài khoản Real Estate OS được công ty cấp. Vui lòng liên hệ quản trị viên công ty để được tạo tài khoản và phân quyền.'
              : 'Vui lòng liên hệ quản trị viên công ty để được hỗ trợ khôi phục tài khoản và đặt lại mật khẩu.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Đã hiểu'),
          ),
        ],
      ),
    );
  }

  InputDecoration _fieldDecoration({
    required String hint,
    required IconData icon,
    String? error,
    Widget? suffix,
  }) {
    const radius = BorderRadius.all(Radius.circular(9));
    return InputDecoration(
      hintText: hint,
      hintStyle: const TextStyle(color: Color(0xFFE8EAF0), fontSize: 15),
      filled: true,
      fillColor: Colors.white.withValues(alpha: 0.16),
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      prefixIcon: Icon(icon, color: Colors.white, size: 21),
      prefixIconConstraints: const BoxConstraints(minWidth: 44, minHeight: 46),
      suffixIcon: suffix,
      errorText: error,
      errorStyle: const TextStyle(color: Color(0xFFFFD5D5)),
      border: const OutlineInputBorder(borderRadius: radius),
      enabledBorder: OutlineInputBorder(
        borderRadius: radius,
        borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.55)),
      ),
      focusedBorder: const OutlineInputBorder(
        borderRadius: radius,
        borderSide: BorderSide(color: Colors.white, width: 1.5),
      ),
      disabledBorder: OutlineInputBorder(
        borderRadius: radius,
        borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.25)),
      ),
      errorBorder: const OutlineInputBorder(
        borderRadius: radius,
        borderSide: BorderSide(color: Color(0xFFFFBBBB)),
      ),
      focusedErrorBorder: const OutlineInputBorder(
        borderRadius: radius,
        borderSide: BorderSide(color: Color(0xFFFFBBBB), width: 1.5),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF061327),
      body: Stack(
        fit: StackFit.expand,
        children: [
          Image.asset(
            'assets/images/login-city.png',
            fit: BoxFit.cover,
            alignment: Alignment.topCenter,
            excludeFromSemantics: true,
          ),
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                stops: [0, 0.48, 1],
                colors: [
                  Color(0x00061327),
                  Color(0x10061327),
                  Color(0x80061327),
                ],
              ),
            ),
          ),
          SafeArea(
            child: LayoutBuilder(
              builder: (context, constraints) => SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
                child: ConstrainedBox(
                  constraints: BoxConstraints(
                    minHeight: (constraints.maxHeight - 56).clamp(
                      0,
                      double.infinity,
                    ),
                  ),
                  child: Align(
                    alignment: Alignment.bottomCenter,
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 440),
                      child: _LoginGlassPanel(
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Padding(
                                padding: const EdgeInsets.symmetric(
                                  vertical: 10,
                                ),
                                child: Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Container(
                                      width: 34,
                                      height: 36,
                                      decoration: BoxDecoration(
                                        color: Colors.white.withValues(
                                          alpha: 0.38,
                                        ),
                                        borderRadius: BorderRadius.circular(8),
                                        border: Border.all(
                                          color: Colors.white.withValues(
                                            alpha: 0.28,
                                          ),
                                        ),
                                      ),
                                      child: const Icon(
                                        Icons.apartment,
                                        color: Color(0xFF092552),
                                        size: 23,
                                      ),
                                    ),
                                    const SizedBox(width: 9),
                                    const Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          'Real Estate OS',
                                          style: TextStyle(
                                            color: Colors.white,
                                            fontSize: 18,
                                            fontWeight: FontWeight.w700,
                                            height: 1.15,
                                          ),
                                        ),
                                        SizedBox(height: 2),
                                        Text(
                                          'Khám phá không gian sống',
                                          style: TextStyle(
                                            color: Colors.white,
                                            fontSize: 10,
                                            height: 1.2,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(height: 10),
                              _LoginGlassPanel(
                                inner: true,
                                child: Padding(
                                  padding: const EdgeInsets.fromLTRB(
                                    20,
                                    24,
                                    20,
                                    12,
                                  ),
                                  child: AutofillGroup(
                                    child: Form(
                                      key: _formKey,
                                      child: Column(
                                        mainAxisSize: MainAxisSize.min,
                                        crossAxisAlignment:
                                            CrossAxisAlignment.stretch,
                                        children: [
                                          const Text(
                                            'Chào mừng trở lại!',
                                            textAlign: TextAlign.center,
                                            style: TextStyle(
                                              color: Colors.white,
                                              fontSize: 23,
                                              fontWeight: FontWeight.w700,
                                              height: 1.2,
                                            ),
                                          ),
                                          const SizedBox(height: 5),
                                          const Text(
                                            'Đăng nhập vào hệ thống',
                                            textAlign: TextAlign.center,
                                            style: TextStyle(
                                              color: Color(0xFFF1F2F6),
                                              fontSize: 14,
                                              height: 1.3,
                                            ),
                                          ),
                                          const SizedBox(height: 22),
                                          TextFormField(
                                            controller: _identifier,
                                            style: const TextStyle(
                                              color: Colors.white,
                                              fontSize: 15,
                                            ),
                                            cursorColor: Colors.white,
                                            decoration: _fieldDecoration(
                                              hint: 'Email',
                                              icon: Icons.person_outline,
                                              error: _fieldErrors['identifier'],
                                            ),
                                            keyboardType:
                                                TextInputType.emailAddress,
                                            autocorrect: false,
                                            textInputAction:
                                                TextInputAction.next,
                                            autofillHints: const [
                                              AutofillHints.username,
                                              AutofillHints.email,
                                              AutofillHints.telephoneNumber,
                                            ],
                                            enabled: !_submitting,
                                            validator: (value) {
                                              if (value == null ||
                                                  value.trim().isEmpty) {
                                                return 'Nhập email hoặc số điện thoại';
                                              }
                                              return normalizeLoginIdentifier(
                                                        value,
                                                      ) ==
                                                      null
                                                  ? 'Email hoặc số điện thoại chưa đúng'
                                                  : null;
                                            },
                                          ),
                                          const SizedBox(height: 14),
                                          TextFormField(
                                            controller: _password,
                                            style: const TextStyle(
                                              color: Colors.white,
                                              fontSize: 15,
                                            ),
                                            cursorColor: Colors.white,
                                            decoration: _fieldDecoration(
                                              hint: 'Mật khẩu',
                                              icon: Icons.lock_outline,
                                              error: _fieldErrors['password'],
                                              suffix: IconButton(
                                                tooltip: _obscure
                                                    ? 'Hiện mật khẩu'
                                                    : 'Ẩn mật khẩu',
                                                icon: Icon(
                                                  _obscure
                                                      ? Icons
                                                            .visibility_outlined
                                                      : Icons
                                                            .visibility_off_outlined,
                                                  color: Colors.white
                                                      .withValues(alpha: 0.9),
                                                  size: 22,
                                                ),
                                                onPressed: () => setState(
                                                  () => _obscure = !_obscure,
                                                ),
                                              ),
                                            ),
                                            obscureText: _obscure,
                                            autocorrect: false,
                                            enableSuggestions: false,
                                            textInputAction:
                                                TextInputAction.done,
                                            autofillHints: const [
                                              AutofillHints.password,
                                            ],
                                            enabled: !_submitting,
                                            onFieldSubmitted: (_) => _submit(),
                                            validator: (value) =>
                                                value == null || value.isEmpty
                                                ? 'Nhập mật khẩu'
                                                : null,
                                          ),
                                          if (_error != null) ...[
                                            const SizedBox(height: 12),
                                            Semantics(
                                              liveRegion: true,
                                              child: Text(
                                                _error!,
                                                style: const TextStyle(
                                                  color: Color(0xFFFFD5D5),
                                                  fontSize: 13,
                                                ),
                                              ),
                                            ),
                                          ],
                                          const SizedBox(height: 20),
                                          DecoratedBox(
                                            decoration: BoxDecoration(
                                              borderRadius:
                                                  BorderRadius.circular(28),
                                              gradient: const LinearGradient(
                                                colors: [
                                                  Color(0xFF061B43),
                                                  Color(0xFF123984),
                                                  Color(0xFF061B43),
                                                ],
                                              ),
                                              border: Border.all(
                                                color: const Color(0xFF4167C5)
                                                    .withValues(alpha: 0.45),
                                              ),
                                              boxShadow: [
                                                BoxShadow(
                                                  color: const Color(0xFF1C4FD5)
                                                      .withValues(alpha: 0.40),
                                                  blurRadius: 18,
                                                  offset: const Offset(0, 5),
                                                ),
                                              ],
                                            ),
                                            child: FilledButton(
                                              style: FilledButton.styleFrom(
                                                backgroundColor:
                                                    Colors.transparent,
                                                disabledBackgroundColor:
                                                    Colors.transparent,
                                                foregroundColor: Colors.white,
                                                disabledForegroundColor:
                                                    Colors.white70,
                                                shadowColor: Colors.transparent,
                                                minimumSize: const Size(
                                                  double.infinity,
                                                  46,
                                                ),
                                                padding:
                                                    const EdgeInsets.symmetric(
                                                      horizontal: 16,
                                                    ),
                                                textStyle: const TextStyle(
                                                  fontSize: 15,
                                                  fontFamily: 'Roboto',
                                                  fontWeight: FontWeight.w700,
                                                ),
                                                shape: const StadiumBorder(),
                                              ),
                                              onPressed: _submitting
                                                  ? null
                                                  : _submit,
                                              child: _submitting
                                                  ? const SizedBox.square(
                                                      dimension: 20,
                                                      child:
                                                          CircularProgressIndicator(
                                                            strokeWidth: 2,
                                                            color: Colors.white,
                                                          ),
                                                    )
                                                  : const Text('Đăng nhập'),
                                            ),
                                          ),
                                          const SizedBox(height: 10),
                                          Wrap(
                                            alignment:
                                                WrapAlignment.spaceBetween,
                                            spacing: 6,
                                            children: [
                                              TextButton(
                                                style: _linkStyle,
                                                onPressed: _submitting
                                                    ? null
                                                    : () => _accountHelp(
                                                        registration: false,
                                                      ),
                                                child: const Text(
                                                  'Quên mật khẩu?',
                                                ),
                                              ),
                                              TextButton(
                                                style: _linkStyle,
                                                onPressed: _submitting
                                                    ? null
                                                    : () => _accountHelp(
                                                        registration: true,
                                                      ),
                                                child: const Text(
                                                  'Đăng ký tài khoản mới',
                                                ),
                                              ),
                                            ],
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  static final _linkStyle = TextButton.styleFrom(
    foregroundColor: const Color(0xFFE1E5EE),
    textStyle: const TextStyle(
      fontFamily: 'Roboto',
      fontSize: 12,
      fontWeight: FontWeight.w400,
    ),
    padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 8),
    minimumSize: const Size(0, 36),
    tapTargetSize: MaterialTapTargetSize.padded,
  );
}

class _LoginGlassPanel extends StatelessWidget {
  const _LoginGlassPanel({required this.child, this.inner = false});
  final Widget child;
  final bool inner;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(inner ? 10 : 14);
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: radius,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: inner ? 0.16 : 0.24),
            blurRadius: inner ? 10 : 28,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: radius,
        child: BackdropFilter(
          filter: ImageFilter.blur(
            sigmaX: inner ? 4 : 14,
            sigmaY: inner ? 4 : 14,
          ),
          child: DecoratedBox(
            decoration: BoxDecoration(
              borderRadius: radius,
              border: Border.all(
                color: Colors.white.withValues(alpha: inner ? 0.55 : 0.65),
                width: 1,
              ),
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  Colors.white.withValues(alpha: inner ? 0.12 : 0.32),
                  Colors.white.withValues(alpha: inner ? 0.08 : 0.22),
                ],
              ),
            ),
            child: Stack(
              children: [
                Positioned.fill(
                  child: IgnorePointer(
                    child: CustomPaint(
                      painter: _GlassLinesPainter(inner: inner),
                    ),
                  ),
                ),
                child,
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _GlassLinesPainter extends CustomPainter {
  const _GlassLinesPainter({required this.inner});
  final bool inner;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white.withValues(alpha: 0.18)
      ..strokeWidth = 0.8
      ..style = PaintingStyle.stroke;
    for (var i = 0; i < 3; i++) {
      final x = size.width - 30 - i * 13;
      canvas.drawPath(
        Path()
          ..moveTo(x - 38, 0)
          ..lineTo(x - 38, 28 + i * 8)
          ..lineTo(x, 66 + i * 8)
          ..lineTo(x, size.height * 0.43)
          ..lineTo(size.width, size.height * 0.43 + 30 + i * 10),
        paint,
      );
      canvas.drawPath(
        Path()
          ..moveTo(0, size.height - 94 - i * 16)
          ..lineTo(28 + i * 12, size.height - 66)
          ..lineTo(28 + i * 12, size.height)
          ..moveTo(12, size.height - 38 - i * 13)
          ..lineTo(12, size.height - 12)
          ..lineTo(62 + i * 12, size.height - 12),
        paint,
      );
    }
    if (inner) {
      final center = Offset(size.width - 16, size.height - 16);
      canvas.drawPath(
        Path()
          ..moveTo(center.dx, center.dy - 12)
          ..quadraticBezierTo(
            center.dx + 3,
            center.dy - 3,
            center.dx + 12,
            center.dy,
          )
          ..quadraticBezierTo(
            center.dx + 3,
            center.dy + 3,
            center.dx,
            center.dy + 12,
          )
          ..quadraticBezierTo(
            center.dx - 3,
            center.dy + 3,
            center.dx - 12,
            center.dy,
          )
          ..quadraticBezierTo(
            center.dx - 3,
            center.dy - 3,
            center.dx,
            center.dy - 12,
          )
          ..close(),
        Paint()..color = Colors.white.withValues(alpha: 0.24),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _GlassLinesPainter oldDelegate) =>
      oldDelegate.inner != inner;
}
