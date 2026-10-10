import 'package:flutter/material.dart';

import 'app_tokens.dart';

/// Màu theo vai trò mà [ColorScheme] không có: thành công, cảnh báo, thông tin, chữ phụ. Lấy bằng
/// `context.appColors`.
@immutable
class AppColors extends ThemeExtension<AppColors> {
  const AppColors({
    required this.success,
    required this.onSuccess,
    required this.warning,
    required this.onWarning,
    required this.info,
    required this.onInfo,
    required this.mutedForeground,
    required this.border,
  });

  static const light = AppColors(
    success: AppPalette.success700,
    onSuccess: AppPalette.white,
    warning: AppPalette.warning700,
    onWarning: AppPalette.white,
    info: AppPalette.info700,
    onInfo: AppPalette.white,
    mutedForeground: AppPalette.neutral600,
    border: AppPalette.neutral200,
  );

  static const dark = AppColors(
    success: AppPalette.success400,
    onSuccess: AppPalette.success950,
    warning: AppPalette.warning400,
    onWarning: AppPalette.warning950,
    info: AppPalette.info400,
    onInfo: AppPalette.info950,
    mutedForeground: AppPalette.neutral400,
    border: AppPalette.neutral800,
  );

  /// Thành công, BĐS còn hàng.
  final Color success;
  final Color onSuccess;

  /// Cảnh báo, chờ xác minh.
  final Color warning;
  final Color onWarning;

  /// Thông tin, gợi ý.
  final Color info;
  final Color onInfo;

  /// Chữ phụ, metadata.
  final Color mutedForeground;

  /// Đường kẻ, viền thẻ.
  final Color border;

  @override
  AppColors copyWith({
    Color? success,
    Color? onSuccess,
    Color? warning,
    Color? onWarning,
    Color? info,
    Color? onInfo,
    Color? mutedForeground,
    Color? border,
  }) => AppColors(
    success: success ?? this.success,
    onSuccess: onSuccess ?? this.onSuccess,
    warning: warning ?? this.warning,
    onWarning: onWarning ?? this.onWarning,
    info: info ?? this.info,
    onInfo: onInfo ?? this.onInfo,
    mutedForeground: mutedForeground ?? this.mutedForeground,
    border: border ?? this.border,
  );

  @override
  AppColors lerp(AppColors? other, double t) {
    if (other == null) {
      return this;
    }
    return AppColors(
      success: Color.lerp(success, other.success, t)!,
      onSuccess: Color.lerp(onSuccess, other.onSuccess, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      onWarning: Color.lerp(onWarning, other.onWarning, t)!,
      info: Color.lerp(info, other.info, t)!,
      onInfo: Color.lerp(onInfo, other.onInfo, t)!,
      mutedForeground: Color.lerp(mutedForeground, other.mutedForeground, t)!,
      border: Color.lerp(border, other.border, t)!,
    );
  }
}

extension AppColorsContext on BuildContext {
  /// Màu bổ sung của theme hiện tại (sáng hoặc tối).
  AppColors get appColors =>
      Theme.of(this).extension<AppColors>() ?? AppColors.light;
}
