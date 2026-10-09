import type { CurrentUser } from './auth-api.ts';

/**
 * User có permission `code` không (phạm vi bất kỳ). Chỉ dùng để ẩn/hiện giao diện; backend vẫn kiểm quyền
 * thật ở mọi API (phase0/04-RBAC.md mục 1).
 */
export function hasPermission(me: Pick<CurrentUser, 'permissions'>, code: string): boolean {
  return me.permissions.some((permission) => permission.code === code);
}

/** Mục menu chính của admin, mục nào cần quyền thì chỉ hiện khi có quyền đó. */
export const NAV_ITEMS: readonly { href: string; label: string; permission?: string }[] = [
  { href: '/', label: 'Tổng quan' },
  { href: '/properties', label: 'Bất động sản', permission: 'property.view' },
  { href: '/customers', label: 'Khách hàng', permission: 'customer.view' },
  { href: '/appointments', label: 'Lịch hẹn', permission: 'appointment.view' },
  { href: '/deals', label: 'Giao dịch', permission: 'deal.view' },
  { href: '/users', label: 'Người dùng', permission: 'user.view' },
  { href: '/teams', label: 'Team', permission: 'team.view' },
  { href: '/roles', label: 'Vai trò', permission: 'admin.manage' },
  { href: '/company', label: 'Công ty', permission: 'admin.manage' },
];

export function navItemsFor(me: Pick<CurrentUser, 'permissions'>) {
  return NAV_ITEMS.filter((item) => !item.permission || hasPermission(me, item.permission));
}
