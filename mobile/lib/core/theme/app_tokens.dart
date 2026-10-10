import 'package:flutter/widgets.dart';

/// Giá trị nền của giao diện, theo bảng token đề xuất ở design system (PR #16, `tokens.json`). Widget không viết
/// hex, px tuỳ ý mà dùng các hằng số này hoặc `Theme.of(context)`.
abstract final class AppPalette {
  static const white = Color(0xFFFFFFFF);

  static const brand50 = Color(0xFFEFF6FF);
  static const brand200 = Color(0xFFBFDBFE);
  static const brand400 = Color(0xFF60A5FA);
  static const brand600 = Color(0xFF2563EB);
  static const brand700 = Color(0xFF1D4ED8);
  static const brand800 = Color(0xFF1E40AF);
  static const brand950 = Color(0xFF172554);

  static const neutral50 = Color(0xFFF8FAFC);
  static const neutral100 = Color(0xFFF1F5F9);
  static const neutral200 = Color(0xFFE2E8F0);
  static const neutral400 = Color(0xFF94A3B8);
  static const neutral450 = Color(0xFF7C8BA1);
  static const neutral500 = Color(0xFF64748B);
  static const neutral600 = Color(0xFF475569);
  static const neutral800 = Color(0xFF1E293B);
  static const neutral900 = Color(0xFF0F172A);
  static const neutral950 = Color(0xFF020617);

  static const success400 = Color(0xFF4ADE80);
  static const success700 = Color(0xFF15803D);
  static const success950 = Color(0xFF052E16);
  static const warning400 = Color(0xFFFBBF24);
  static const warning700 = Color(0xFFB45309);
  static const warning950 = Color(0xFF451A03);
  static const danger400 = Color(0xFFF87171);
  static const danger600 = Color(0xFFDC2626);
  static const danger950 = Color(0xFF450A0A);
  static const info400 = Color(0xFF38BDF8);
  static const info700 = Color(0xFF0369A1);
  static const info950 = Color(0xFF082F49);
}

/// Khoảng cách (px), bội số của 4.
abstract final class AppSpacing {
  static const s2 = 2.0;
  static const s4 = 4.0;
  static const s8 = 8.0;
  static const s12 = 12.0;
  static const s16 = 16.0;
  static const s20 = 20.0;
  static const s24 = 24.0;
  static const s32 = 32.0;
  static const s48 = 48.0;

  /// Lề hai bên màn hình điện thoại.
  static const gutter = s16;

  /// Vùng chạm tối thiểu.
  static const minTouchTarget = 48.0;
}

/// Bo góc.
abstract final class AppRadius {
  static const sm = Radius.circular(4);
  static const md = Radius.circular(6);
  static const lg = Radius.circular(8);
  static const xl = Radius.circular(12);
  static const xxl = Radius.circular(16);
  static const full = Radius.circular(999);
}

/// Thời gian chuyển động.
abstract final class AppDurations {
  static const fast = Duration(milliseconds: 150);
  static const normal = Duration(milliseconds: 200);
  static const slow = Duration(milliseconds: 300);
}
