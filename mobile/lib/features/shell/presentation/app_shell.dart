import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/format/vn_format.dart';
import '../../../core/theme/app_colors.dart';
import '../../notifications/presentation/notifications_controller.dart';

/// Khung chính có thanh điều hướng dưới với 5 tab (MASTER_PLAN mục 24). Mỗi tab giữ lịch sử riêng.
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  static const destinations = [
    NavigationDestination(
      icon: Icon(Icons.home_outlined),
      selectedIcon: Icon(Icons.home),
      label: 'Trang chủ',
    ),
    NavigationDestination(
      icon: Icon(Icons.apartment_outlined),
      selectedIcon: Icon(Icons.apartment),
      label: 'BĐS',
    ),
    NavigationDestination(
      icon: Icon(Icons.people_outline),
      selectedIcon: Icon(Icons.people),
      label: 'Khách hàng',
    ),
    NavigationDestination(
      icon: Icon(Icons.notifications_outlined),
      selectedIcon: Icon(Icons.notifications),
      label: 'Thông báo',
    ),
    NavigationDestination(
      icon: Icon(Icons.person_outline),
      selectedIcon: Icon(Icons.person),
      label: 'Tài khoản',
    ),
  ];

  /// Vị trí tab "Thông báo".
  static const notificationsIndex = 3;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unread = ref.watch(unreadCountProvider).value ?? 0;
    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(
          border: Border(top: BorderSide(color: context.appColors.border)),
        ),
        child: NavigationBar(
          selectedIndex: navigationShell.currentIndex,
          destinations: [
            for (final (index, destination) in destinations.indexed)
              index == notificationsIndex && unread > 0
                  ? NavigationDestination(
                      icon: Badge(
                        label: Text(unread > 99 ? '99+' : vnNumber(unread)),
                        child: destination.icon,
                      ),
                      selectedIcon: Badge(
                        label: Text(unread > 99 ? '99+' : vnNumber(unread)),
                        child: destination.selectedIcon,
                      ),
                      label: destination.label,
                      tooltip:
                          '${destination.label}, ${vnNumber(unread)} chưa đọc',
                    )
                  : destination,
          ],
          // Bấm lại tab đang mở thì về màn hình đầu của tab đó.
          onDestinationSelected: (index) {
            // Chuyển sang tab thông báo thì tải lại hộp thư và số chưa đọc (vẫn hiện dữ liệu cũ trong lúc tải).
            if (index == notificationsIndex &&
                index != navigationShell.currentIndex) {
              ref
                ..invalidate(unreadCountProvider)
                ..invalidate(notificationListProvider);
            }
            navigationShell.goBranch(
              index,
              initialLocation: index == navigationShell.currentIndex,
            );
          },
        ),
      ),
    );
  }
}
