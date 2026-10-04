// GENERATED — không sửa tay. Nguồn: docs/design-system/tokens/tokens.json. Chạy: npm run tokens:build
// ignore_for_file: lines_longer_than_80_chars

import 'package:flutter/material.dart';

/// Màu theo vai trò (giống tên biến CSS của shadcn/ui). Dùng `AppColorTokens.light` / `.dark`.
class AppColorTokens {
  const AppColorTokens({
    required this.background,
    required this.foreground,
    required this.card,
    required this.cardForeground,
    required this.popover,
    required this.popoverForeground,
    required this.primary,
    required this.primaryForeground,
    required this.secondary,
    required this.secondaryForeground,
    required this.muted,
    required this.mutedForeground,
    required this.accent,
    required this.accentForeground,
    required this.destructive,
    required this.destructiveForeground,
    required this.success,
    required this.successForeground,
    required this.warning,
    required this.warningForeground,
    required this.info,
    required this.infoForeground,
    required this.border,
    required this.input,
    required this.ring,
    required this.chart1,
    required this.chart2,
    required this.chart3,
    required this.chart4,
    required this.chart5,
    required this.sidebar,
    required this.sidebarForeground,
    required this.sidebarPrimary,
    required this.sidebarPrimaryForeground,
    required this.sidebarAccent,
    required this.sidebarAccentForeground,
    required this.sidebarBorder,
    required this.sidebarRing,
  });

  final Color background;
  final Color foreground;
  final Color card;
  final Color cardForeground;
  final Color popover;
  final Color popoverForeground;
  final Color primary;
  final Color primaryForeground;
  final Color secondary;
  final Color secondaryForeground;
  final Color muted;
  final Color mutedForeground;
  final Color accent;
  final Color accentForeground;
  final Color destructive;
  final Color destructiveForeground;
  final Color success;
  final Color successForeground;
  final Color warning;
  final Color warningForeground;
  final Color info;
  final Color infoForeground;
  final Color border;
  final Color input;
  final Color ring;
  final Color chart1;
  final Color chart2;
  final Color chart3;
  final Color chart4;
  final Color chart5;
  final Color sidebar;
  final Color sidebarForeground;
  final Color sidebarPrimary;
  final Color sidebarPrimaryForeground;
  final Color sidebarAccent;
  final Color sidebarAccentForeground;
  final Color sidebarBorder;
  final Color sidebarRing;

  static const light = AppColorTokens(
    background: Color(0xFFFFFFFF),
    foreground: Color(0xFF0F172A),
    card: Color(0xFFFFFFFF),
    cardForeground: Color(0xFF0F172A),
    popover: Color(0xFFFFFFFF),
    popoverForeground: Color(0xFF0F172A),
    primary: Color(0xFF1D4ED8),
    primaryForeground: Color(0xFFFFFFFF),
    secondary: Color(0xFFF1F5F9),
    secondaryForeground: Color(0xFF0F172A),
    muted: Color(0xFFF1F5F9),
    mutedForeground: Color(0xFF475569),
    accent: Color(0xFFEFF6FF),
    accentForeground: Color(0xFF1E40AF),
    destructive: Color(0xFFDC2626),
    destructiveForeground: Color(0xFFFFFFFF),
    success: Color(0xFF15803D),
    successForeground: Color(0xFFFFFFFF),
    warning: Color(0xFFB45309),
    warningForeground: Color(0xFFFFFFFF),
    info: Color(0xFF0369A1),
    infoForeground: Color(0xFFFFFFFF),
    border: Color(0xFFE2E8F0),
    input: Color(0xFF7C8BA1),
    ring: Color(0xFF2563EB),
    chart1: Color(0xFF2563EB),
    chart2: Color(0xFF0D9488),
    chart3: Color(0xFFD97706),
    chart4: Color(0xFFDB2777),
    chart5: Color(0xFF7C3AED),
    sidebar: Color(0xFFF8FAFC),
    sidebarForeground: Color(0xFF0F172A),
    sidebarPrimary: Color(0xFF1D4ED8),
    sidebarPrimaryForeground: Color(0xFFFFFFFF),
    sidebarAccent: Color(0xFFF1F5F9),
    sidebarAccentForeground: Color(0xFF0F172A),
    sidebarBorder: Color(0xFFE2E8F0),
    sidebarRing: Color(0xFF2563EB),
  );

  static const dark = AppColorTokens(
    background: Color(0xFF020617),
    foreground: Color(0xFFF8FAFC),
    card: Color(0xFF0F172A),
    cardForeground: Color(0xFFF8FAFC),
    popover: Color(0xFF0F172A),
    popoverForeground: Color(0xFFF8FAFC),
    primary: Color(0xFF60A5FA),
    primaryForeground: Color(0xFF172554),
    secondary: Color(0xFF1E293B),
    secondaryForeground: Color(0xFFF8FAFC),
    muted: Color(0xFF1E293B),
    mutedForeground: Color(0xFF94A3B8),
    accent: Color(0xFF172554),
    accentForeground: Color(0xFFBFDBFE),
    destructive: Color(0xFFF87171),
    destructiveForeground: Color(0xFF450A0A),
    success: Color(0xFF4ADE80),
    successForeground: Color(0xFF052E16),
    warning: Color(0xFFFBBF24),
    warningForeground: Color(0xFF451A03),
    info: Color(0xFF38BDF8),
    infoForeground: Color(0xFF082F49),
    border: Color(0xFF1E293B),
    input: Color(0xFF64748B),
    ring: Color(0xFF60A5FA),
    chart1: Color(0xFF60A5FA),
    chart2: Color(0xFF2DD4BF),
    chart3: Color(0xFFFBBF24),
    chart4: Color(0xFFF472B6),
    chart5: Color(0xFFA78BFA),
    sidebar: Color(0xFF0F172A),
    sidebarForeground: Color(0xFFF8FAFC),
    sidebarPrimary: Color(0xFF60A5FA),
    sidebarPrimaryForeground: Color(0xFF172554),
    sidebarAccent: Color(0xFF1E293B),
    sidebarAccentForeground: Color(0xFFF8FAFC),
    sidebarBorder: Color(0xFF1E293B),
    sidebarRing: Color(0xFF60A5FA),
  );

  ColorScheme toColorScheme(Brightness brightness) => ColorScheme(
        brightness: brightness,
        primary: primary,
        onPrimary: primaryForeground,
        primaryContainer: accent,
        onPrimaryContainer: accentForeground,
        secondary: secondary,
        onSecondary: secondaryForeground,
        secondaryContainer: accent,
        onSecondaryContainer: accentForeground,
        error: destructive,
        onError: destructiveForeground,
        surface: background,
        onSurface: foreground,
        onSurfaceVariant: mutedForeground,
        surfaceContainerLowest: background,
        surfaceContainerLow: card,
        surfaceContainer: card,
        surfaceContainerHigh: muted,
        surfaceContainerHighest: muted,
        outline: input,
        outlineVariant: border,
        shadow: Colors.black,
        scrim: Colors.black,
      );
}

/// Font và kiểu chữ. `textTheme` ánh xạ sang TextTheme Material 3.
abstract final class AppTypography {
  static const fontFamily = 'Be Vietnam Pro';
  static const fontFamilyFallback = <String>['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'];

  static const display = TextStyle(
    fontFamily: fontFamily,
    fontFamilyFallback: fontFamilyFallback,
    fontSize: 36.0,
    height: 1.1111,
    fontWeight: FontWeight.w700,
  );
  static const h1 = TextStyle(
    fontFamily: fontFamily,
    fontFamilyFallback: fontFamilyFallback,
    fontSize: 30.0,
    height: 1.2,
    fontWeight: FontWeight.w600,
  );
  static const h2 = TextStyle(
    fontFamily: fontFamily,
    fontFamilyFallback: fontFamilyFallback,
    fontSize: 24.0,
    height: 1.3333,
    fontWeight: FontWeight.w600,
  );
  static const h3 = TextStyle(
    fontFamily: fontFamily,
    fontFamilyFallback: fontFamilyFallback,
    fontSize: 20.0,
    height: 1.4,
    fontWeight: FontWeight.w600,
  );
  static const title = TextStyle(
    fontFamily: fontFamily,
    fontFamilyFallback: fontFamilyFallback,
    fontSize: 18.0,
    height: 1.5556,
    fontWeight: FontWeight.w600,
  );
  static const subtitle = TextStyle(
    fontFamily: fontFamily,
    fontFamilyFallback: fontFamilyFallback,
    fontSize: 16.0,
    height: 1.5,
    fontWeight: FontWeight.w500,
  );
  static const body = TextStyle(
    fontFamily: fontFamily,
    fontFamilyFallback: fontFamilyFallback,
    fontSize: 16.0,
    height: 1.5,
    fontWeight: FontWeight.w400,
  );
  static const bodySm = TextStyle(
    fontFamily: fontFamily,
    fontFamilyFallback: fontFamilyFallback,
    fontSize: 14.0,
    height: 1.4286,
    fontWeight: FontWeight.w400,
  );
  static const label = TextStyle(
    fontFamily: fontFamily,
    fontFamilyFallback: fontFamilyFallback,
    fontSize: 14.0,
    height: 1.4286,
    fontWeight: FontWeight.w500,
  );
  static const caption = TextStyle(
    fontFamily: fontFamily,
    fontFamilyFallback: fontFamilyFallback,
    fontSize: 12.0,
    height: 1.3333,
    fontWeight: FontWeight.w400,
  );

  static const textTheme = TextTheme(
    displaySmall: display,
    headlineLarge: h1,
    headlineMedium: h2,
    headlineSmall: h3,
    titleLarge: title,
    titleMedium: subtitle,
    bodyLarge: body,
    bodyMedium: bodySm,
    labelLarge: label,
    bodySmall: caption,
  );
}

/// Khoảng cách (px logic), tên theo giá trị: s16 = 16. Tương ứng Tailwind: s16 = p-4.
abstract final class AppSpacing {
  static const s0 = 0.0;
  static const s2 = 2.0;
  static const s4 = 4.0;
  static const s6 = 6.0;
  static const s8 = 8.0;
  static const s12 = 12.0;
  static const s16 = 16.0;
  static const s20 = 20.0;
  static const s24 = 24.0;
  static const s32 = 32.0;
  static const s40 = 40.0;
  static const s48 = 48.0;
  static const s64 = 64.0;
}

/// Bo góc (px logic).
abstract final class AppRadius {
  static const sm = 4.0;
  static const md = 6.0;
  static const lg = 8.0;
  static const xl = 12.0;
  static const xxl = 16.0;
  static const full = 9999.0;
}

/// Đổ bóng, tương ứng shadow-sm/md/lg/xl của Tailwind.
abstract final class AppShadows {
  static const sm = <BoxShadow>[
    BoxShadow(color: Color(0x0F0F172A), offset: Offset(0.0, 1.0), blurRadius: 2.0, spreadRadius: 0.0),
  ];
  static const md = <BoxShadow>[
    BoxShadow(color: Color(0x140F172A), offset: Offset(0.0, 4.0), blurRadius: 6.0, spreadRadius: -1.0),
    BoxShadow(color: Color(0x0F0F172A), offset: Offset(0.0, 2.0), blurRadius: 4.0, spreadRadius: -2.0),
  ];
  static const lg = <BoxShadow>[
    BoxShadow(color: Color(0x1A0F172A), offset: Offset(0.0, 10.0), blurRadius: 15.0, spreadRadius: -3.0),
    BoxShadow(color: Color(0x140F172A), offset: Offset(0.0, 4.0), blurRadius: 6.0, spreadRadius: -4.0),
  ];
  static const xl = <BoxShadow>[
    BoxShadow(color: Color(0x1F0F172A), offset: Offset(0.0, 20.0), blurRadius: 25.0, spreadRadius: -5.0),
    BoxShadow(color: Color(0x140F172A), offset: Offset(0.0, 8.0), blurRadius: 10.0, spreadRadius: -6.0),
  ];
}

/// Mốc chiều rộng cửa sổ theo window size class Material 3 (compact < medium).
abstract final class AppBreakpoints {
  static const medium = 600.0;
  static const expanded = 840.0;
  static const large = 1200.0;
}

/// Kích thước bố cục (px logic).
abstract final class AppLayout {
  static const containerMaxWidth = 1280.0;
  static const sidebarWidth = 256.0;
  static const sidebarCollapsedWidth = 64.0;
  static const headerHeight = 56.0;
  static const bottomNavHeight = 64.0;
  static const gutterCompact = 16.0;
  static const gutterMedium = 24.0;
  static const gutterExpanded = 32.0;
  static const minTouchTarget = 44.0;
}

/// Thời lượng chuyển động.
abstract final class AppDurations {
  static const fast = Duration(milliseconds: 150);
  static const normal = Duration(milliseconds: 200);
  static const slow = Duration(milliseconds: 300);
  static const slower = Duration(milliseconds: 500);
}

/// Đường cong chuyển động (cubic-bezier).
abstract final class AppEasing {
  static const standard = Cubic(0.2, 0.0, 0.0, 1.0);
  static const decelerate = Cubic(0.0, 0.0, 0.0, 1.0);
  static const accelerate = Cubic(0.3, 0.0, 1.0, 1.0);
}

/// Kích thước icon.
abstract final class AppIconSize {
  static const sm = 16.0;
  static const md = 20.0;
  static const lg = 24.0;
  static const strokeWidth = 2.0;
}
