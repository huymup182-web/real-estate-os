import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/customers/presentation/customers_screen.dart';
import '../../features/home/presentation/home_screen.dart';
import '../../features/notifications/presentation/notifications_screen.dart';
import '../../features/profile/presentation/profile_screen.dart';
import '../../features/properties/presentation/properties_screen.dart';
import '../../features/shell/presentation/app_shell.dart';

/// Đường dẫn các màn hình; màn hình mới thêm vào đây.
abstract final class AppRoutes {
  static const home = '/home';
  static const properties = '/properties';
  static const customers = '/customers';
  static const notifications = '/notifications';
  static const profile = '/profile';
}

/// Router của app. Splash, đăng nhập và chặn khi chưa đăng nhập thêm ở TASK-115, TASK-116.
final routerProvider = Provider<GoRouter>((ref) {
  final router = GoRouter(
    initialLocation: AppRoutes.home,
    routes: [
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) =>
            AppShell(navigationShell: navigationShell),
        branches: [
          _branch(AppRoutes.home, const HomeScreen()),
          _branch(AppRoutes.properties, const PropertiesScreen()),
          _branch(AppRoutes.customers, const CustomersScreen()),
          _branch(AppRoutes.notifications, const NotificationsScreen()),
          _branch(AppRoutes.profile, const ProfileScreen()),
        ],
      ),
    ],
  );
  ref.onDispose(router.dispose);
  return router;
});

StatefulShellBranch _branch(String path, Widget screen) => StatefulShellBranch(
  routes: [GoRoute(path: path, builder: (context, state) => screen)],
);
