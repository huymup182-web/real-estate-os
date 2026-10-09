import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:real_estate_os/core/theme/app_colors.dart';
import 'package:real_estate_os/core/theme/app_theme.dart';

/// Tỉ lệ tương phản WCAG 2.2 giữa hai màu đặc.
double contrast(Color a, Color b) {
  final la = a.computeLuminance();
  final lb = b.computeLuminance();
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}

void main() {
  for (final (name, theme) in [
    ('sáng', AppTheme.light),
    ('tối', AppTheme.dark),
  ]) {
    group('theme $name', () {
      final scheme = theme.colorScheme;
      final colors = theme.extension<AppColors>()!;

      test('cặp chữ/nền đạt WCAG AA (4.5), viền ô nhập đạt 3', () {
        final pairs = <String, (Color, Color, double)>{
          'onSurface/surface': (scheme.onSurface, scheme.surface, 4.5),
          'onPrimary/primary': (scheme.onPrimary, scheme.primary, 4.5),
          'onPrimaryContainer/primaryContainer': (
            scheme.onPrimaryContainer,
            scheme.primaryContainer,
            4.5,
          ),
          'onSecondary/secondary': (scheme.onSecondary, scheme.secondary, 4.5),
          'onError/error': (scheme.onError, scheme.error, 4.5),
          'onSurfaceVariant/surface': (
            scheme.onSurfaceVariant,
            scheme.surface,
            4.5,
          ),
          'onSurfaceVariant/surfaceContainerHighest': (
            scheme.onSurfaceVariant,
            scheme.surfaceContainerHighest,
            4.5,
          ),
          'mutedForeground/surface': (
            colors.mutedForeground,
            scheme.surface,
            4.5,
          ),
          'onSuccess/success': (colors.onSuccess, colors.success, 4.5),
          'onWarning/warning': (colors.onWarning, colors.warning, 4.5),
          'onInfo/info': (colors.onInfo, colors.info, 4.5),
          'primary/surface (link)': (scheme.primary, scheme.surface, 4.5),
          'error/surface (chữ lỗi)': (scheme.error, scheme.surface, 4.5),
          'outline/surface (viền ô nhập)': (scheme.outline, scheme.surface, 3),
        };
        for (final MapEntry(key: pair, value: (fg, bg, min)) in pairs.entries) {
          expect(
            contrast(fg, bg),
            greaterThanOrEqualTo(min),
            reason: '$pair = ${contrast(fg, bg).toStringAsFixed(2)}',
          );
        }
      });

      test('cỡ chữ theo design system, nút cao tối thiểu 48', () {
        expect(theme.textTheme.bodyLarge?.fontSize, 16);
        expect(theme.textTheme.bodyMedium?.fontSize, 14);
        expect(theme.textTheme.titleLarge?.fontWeight, FontWeight.w600);
        expect(theme.textTheme.headlineMedium?.fontSize, 24);
        final size = theme.filledButtonTheme.style?.minimumSize?.resolve({});
        expect(size?.height, 48);
      });
    });
  }

  test('AppColors.lerp và copyWith', () {
    expect(
      AppColors.light.lerp(AppColors.dark, 1).success,
      AppColors.dark.success,
    );
    expect(AppColors.light.lerp(null, 0.5), AppColors.light);
    expect(AppColors.light.copyWith(info: Colors.red).info, Colors.red);
  });

  testWidgets('context.appColors theo theme đang dùng', (tester) async {
    late AppColors light;
    late AppColors dark;
    await tester.pumpWidget(
      Column(
        children: [
          Theme(
            data: AppTheme.light,
            child: Builder(
              builder: (context) {
                light = context.appColors;
                return const SizedBox();
              },
            ),
          ),
          Theme(
            data: AppTheme.dark,
            child: Builder(
              builder: (context) {
                dark = context.appColors;
                return const SizedBox();
              },
            ),
          ),
        ],
      ),
    );
    expect(light.success, AppColors.light.success);
    expect(dark.success, AppColors.dark.success);
  });
}
