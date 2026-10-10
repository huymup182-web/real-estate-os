import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/presentation/login_screen.dart';
import '../../features/auth/presentation/session_controller.dart';
import '../../features/customers/presentation/customer_detail_screen.dart';
import '../../features/customers/presentation/customers_screen.dart';
import '../../features/customers/presentation/pipeline_screen.dart';
import '../../features/home/presentation/home_screen.dart';
import '../../features/notifications/presentation/notifications_screen.dart';
import '../../features/profile/presentation/profile_screen.dart';
import '../../features/properties/presentation/favorites_screen.dart';
import '../../features/properties/presentation/properties_screen.dart';
import '../../features/properties/presentation/property_create_screen.dart';
import '../../features/properties/presentation/property_detail_screen.dart';
import '../../features/properties/presentation/property_edit_screen.dart';
import '../../features/properties/presentation/property_images_screen.dart';
import '../../features/shell/presentation/app_shell.dart';
import '../../features/splash/presentation/splash_screen.dart';

/// Đường dẫn các màn hình; màn hình mới thêm vào đây.
abstract final class AppRoutes {
  static const splash = '/splash';
  static const login = '/login';
  static const home = '/home';
  static const properties = '/properties';
  static const customers = '/customers';
  static const notifications = '/notifications';
  static const profile = '/profile';

  static const propertyCreate = '$properties/new';
  static const propertyFavorites = '$properties/favorites';

  /// Chi tiết BĐS, nằm trong tab "BĐS" (thanh tab dưới vẫn hiện).
  static String propertyDetail(String id) => '$properties/$id';

  static String propertyEdit(String id) => '$properties/$id/edit';

  static String propertyImages(String id) => '$properties/$id/images';

  static const customerPipeline = '$customers/pipeline';

  /// Chi tiết khách, nằm trong tab "Khách hàng".
  static String customerDetail(String id) => '$customers/$id';
}

/// Router của app. Chuyển màn hình theo phiên đăng nhập ([sessionProvider]): đang kiểm hoặc lỗi → splash, chưa
/// đăng nhập → đăng nhập, đã đăng nhập mà đang ở splash/đăng nhập → trang chủ.
final routerProvider = Provider<GoRouter>((ref) {
  final sessionChanged = ValueNotifier<int>(0);
  ref.listen(sessionProvider, (_, _) => sessionChanged.value++);
  final router = GoRouter(
    initialLocation: AppRoutes.splash,
    refreshListenable: sessionChanged,
    redirect: (context, state) =>
        redirectFor(ref.read(sessionProvider), state.matchedLocation),
    routes: [
      GoRoute(
        path: AppRoutes.splash,
        builder: (context, state) => const SplashScreen(),
      ),
      GoRoute(
        path: AppRoutes.login,
        builder: (context, state) => const LoginScreen(),
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) =>
            AppShell(navigationShell: navigationShell),
        branches: [
          _branch(AppRoutes.home, const HomeScreen()),
          _branch(
            AppRoutes.properties,
            const PropertiesScreen(),
            routes: [
              // Trước ':id' để "new", "favorites" không bị hiểu là id.
              GoRoute(
                path: 'new',
                builder: (context, state) => const PropertyCreateScreen(),
              ),
              GoRoute(
                path: 'favorites',
                builder: (context, state) => const FavoritesScreen(),
              ),
              GoRoute(
                path: ':id',
                builder: (context, state) => PropertyDetailScreen(
                  propertyId: state.pathParameters['id']!,
                ),
                routes: [
                  GoRoute(
                    path: 'edit',
                    builder: (context, state) => PropertyEditScreen(
                      propertyId: state.pathParameters['id']!,
                    ),
                  ),
                  GoRoute(
                    path: 'images',
                    builder: (context, state) => PropertyImagesScreen(
                      propertyId: state.pathParameters['id']!,
                    ),
                  ),
                ],
              ),
            ],
          ),
          _branch(
            AppRoutes.customers,
            const CustomersScreen(),
            routes: [
              // Trước ':id' để "pipeline" không bị hiểu là id.
              GoRoute(
                path: 'pipeline',
                builder: (context, state) => const PipelineScreen(),
              ),
              GoRoute(
                path: ':id',
                builder: (context, state) => CustomerDetailScreen(
                  customerId: state.pathParameters['id']!,
                ),
              ),
            ],
          ),
          _branch(AppRoutes.notifications, const NotificationsScreen()),
          _branch(AppRoutes.profile, const ProfileScreen()),
        ],
      ),
    ],
  );
  ref.onDispose(() {
    router.dispose();
    sessionChanged.dispose();
  });
  return router;
});

/// Đường dẫn cần chuyển tới theo phiên đăng nhập, hoặc null để ở lại [location].
String? redirectFor(AsyncValue<Session> session, String location) {
  final value = session.isLoading || session.hasError ? null : session.value;
  if (value == null) {
    return location == AppRoutes.splash ? null : AppRoutes.splash;
  }
  if (!value.isAuthenticated) {
    return location == AppRoutes.login ? null : AppRoutes.login;
  }
  return location == AppRoutes.splash || location == AppRoutes.login
      ? AppRoutes.home
      : null;
}

StatefulShellBranch _branch(
  String path,
  Widget screen, {
  List<RouteBase> routes = const [],
}) => StatefulShellBranch(
  routes: [
    GoRoute(path: path, builder: (context, state) => screen, routes: routes),
  ],
);
