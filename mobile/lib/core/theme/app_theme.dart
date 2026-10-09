import 'package:flutter/material.dart';

import 'app_colors.dart';
import 'app_tokens.dart';

/// Theme sáng và tối của app (Material 3), màu và cỡ chữ theo design system. Font dùng font hệ thống
/// (Roboto / SF Pro), có đủ dấu tiếng Việt.
abstract final class AppTheme {
  static final ThemeData light = _build(
    brightness: Brightness.light,
    scheme: const ColorScheme(
      brightness: Brightness.light,
      primary: AppPalette.brand700,
      onPrimary: AppPalette.white,
      primaryContainer: AppPalette.brand50,
      onPrimaryContainer: AppPalette.brand800,
      secondary: AppPalette.neutral100,
      onSecondary: AppPalette.neutral900,
      secondaryContainer: AppPalette.neutral100,
      onSecondaryContainer: AppPalette.neutral900,
      error: AppPalette.danger600,
      onError: AppPalette.white,
      surface: AppPalette.white,
      onSurface: AppPalette.neutral900,
      onSurfaceVariant: AppPalette.neutral600,
      surfaceContainerLowest: AppPalette.white,
      surfaceContainerLow: AppPalette.neutral50,
      surfaceContainer: AppPalette.neutral50,
      surfaceContainerHigh: AppPalette.neutral100,
      surfaceContainerHighest: AppPalette.neutral100,
      outline: AppPalette.neutral450,
      outlineVariant: AppPalette.neutral200,
      inverseSurface: AppPalette.neutral900,
      onInverseSurface: AppPalette.neutral50,
      inversePrimary: AppPalette.brand400,
      shadow: Color(0xFF000000),
      scrim: Color(0xFF000000),
      surfaceTint: Colors.transparent,
    ),
    colors: AppColors.light,
  );

  static final ThemeData dark = _build(
    brightness: Brightness.dark,
    scheme: const ColorScheme(
      brightness: Brightness.dark,
      primary: AppPalette.brand400,
      onPrimary: AppPalette.brand950,
      primaryContainer: AppPalette.brand950,
      onPrimaryContainer: AppPalette.brand200,
      secondary: AppPalette.neutral800,
      onSecondary: AppPalette.neutral50,
      secondaryContainer: AppPalette.neutral800,
      onSecondaryContainer: AppPalette.neutral50,
      error: AppPalette.danger400,
      onError: AppPalette.danger950,
      surface: AppPalette.neutral950,
      onSurface: AppPalette.neutral50,
      onSurfaceVariant: AppPalette.neutral400,
      surfaceContainerLowest: AppPalette.neutral950,
      surfaceContainerLow: AppPalette.neutral900,
      surfaceContainer: AppPalette.neutral900,
      surfaceContainerHigh: AppPalette.neutral800,
      surfaceContainerHighest: AppPalette.neutral800,
      outline: AppPalette.neutral500,
      outlineVariant: AppPalette.neutral800,
      inverseSurface: AppPalette.neutral50,
      onInverseSurface: AppPalette.neutral900,
      inversePrimary: AppPalette.brand700,
      shadow: Color(0xFF000000),
      scrim: Color(0xFF000000),
      surfaceTint: Colors.transparent,
    ),
    colors: AppColors.dark,
  );

  /// Cỡ chữ / chiều cao dòng (px) và độ đậm theo bảng typography của design system.
  static TextTheme _textTheme(TextTheme base) {
    TextStyle style(
      TextStyle? from,
      double size,
      double line,
      FontWeight weight,
    ) => (from ?? const TextStyle()).copyWith(
      fontSize: size,
      height: line / size,
      fontWeight: weight,
      letterSpacing: 0,
    );
    return base.copyWith(
      displaySmall: style(base.displaySmall, 36, 40, FontWeight.w700),
      headlineLarge: style(base.headlineLarge, 30, 36, FontWeight.w600),
      headlineMedium: style(base.headlineMedium, 24, 32, FontWeight.w600),
      headlineSmall: style(base.headlineSmall, 20, 28, FontWeight.w600),
      titleLarge: style(base.titleLarge, 18, 28, FontWeight.w600),
      titleMedium: style(base.titleMedium, 16, 24, FontWeight.w500),
      titleSmall: style(base.titleSmall, 14, 20, FontWeight.w500),
      bodyLarge: style(base.bodyLarge, 16, 24, FontWeight.w400),
      bodyMedium: style(base.bodyMedium, 14, 20, FontWeight.w400),
      bodySmall: style(base.bodySmall, 12, 16, FontWeight.w400),
      labelLarge: style(base.labelLarge, 14, 20, FontWeight.w500),
      labelMedium: style(base.labelMedium, 12, 16, FontWeight.w500),
      labelSmall: style(base.labelSmall, 12, 16, FontWeight.w500),
    );
  }

  static ThemeData _build({
    required Brightness brightness,
    required ColorScheme scheme,
    required AppColors colors,
  }) {
    final base = ThemeData(
      brightness: brightness,
      colorScheme: scheme,
      useMaterial3: true,
    );
    final text = _textTheme(base.textTheme)
        .apply(bodyColor: scheme.onSurface, displayColor: scheme.onSurface);
    const controlShape = RoundedRectangleBorder(
      borderRadius: BorderRadius.all(AppRadius.lg),
    );
    const buttonSize = Size(64, AppSpacing.minTouchTarget);
    const buttonPadding = EdgeInsets.symmetric(horizontal: AppSpacing.s16);
    OutlineInputBorder inputBorder(Color color, [double width = 1]) =>
        OutlineInputBorder(
          borderRadius: const BorderRadius.all(AppRadius.lg),
          borderSide: BorderSide(color: color, width: width),
        );

    return base.copyWith(
      scaffoldBackgroundColor: scheme.surface,
      textTheme: text,
      extensions: [colors],
      visualDensity: VisualDensity.standard,
      materialTapTargetSize: MaterialTapTargetSize.padded,
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: text.titleLarge,
        shape: Border(bottom: BorderSide(color: colors.border)),
      ),
      cardTheme: CardThemeData(
        color: scheme.surfaceContainerLowest,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: const BorderRadius.all(AppRadius.xl),
          side: BorderSide(color: colors.border),
        ),
      ),
      dividerTheme: DividerThemeData(
        color: colors.border,
        thickness: 1,
        space: 1,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: buttonSize,
          padding: buttonPadding,
          shape: controlShape,
          textStyle: text.labelLarge,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: buttonSize,
          padding: buttonPadding,
          shape: controlShape,
          foregroundColor: scheme.onSurface,
          side: BorderSide(color: scheme.outline),
          textStyle: text.labelLarge,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: buttonSize,
          padding: buttonPadding,
          shape: controlShape,
          textStyle: text.labelLarge,
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: scheme.surface,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.s12,
          vertical: AppSpacing.s12,
        ),
        hintStyle: text.bodyLarge?.copyWith(color: colors.mutedForeground),
        helperStyle: text.bodySmall?.copyWith(color: colors.mutedForeground),
        errorStyle: text.bodySmall?.copyWith(color: scheme.error),
        border: inputBorder(scheme.outline),
        enabledBorder: inputBorder(scheme.outline),
        focusedBorder: inputBorder(scheme.primary, 2),
        errorBorder: inputBorder(scheme.error),
        focusedErrorBorder: inputBorder(scheme.error, 2),
        disabledBorder: inputBorder(colors.border),
      ),
      chipTheme: ChipThemeData(
        shape: const StadiumBorder(),
        side: BorderSide(color: colors.border),
        labelStyle: text.labelLarge,
        backgroundColor: scheme.surface,
        selectedColor: scheme.primaryContainer,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: scheme.surface,
        indicatorColor: scheme.primaryContainer,
        elevation: 0,
        height: 64,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => text.labelSmall?.copyWith(
            color: states.contains(WidgetState.selected)
                ? scheme.primary
                : colors.mutedForeground,
          ),
        ),
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            size: 24,
            color: states.contains(WidgetState.selected)
                ? scheme.onPrimaryContainer
                : colors.mutedForeground,
          ),
        ),
      ),
      listTileTheme: ListTileThemeData(
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.gutter,
        ),
        subtitleTextStyle: text.bodyMedium?.copyWith(
          color: colors.mutedForeground,
        ),
        iconColor: colors.mutedForeground,
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.all(AppRadius.lg),
        ),
        backgroundColor: scheme.inverseSurface,
        contentTextStyle: text.bodyMedium?.copyWith(
          color: scheme.onInverseSurface,
        ),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(color: scheme.primary),
    );
  }
}
