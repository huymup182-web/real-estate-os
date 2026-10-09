'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Mục menu; đánh dấu trang đang mở (trang con như /users/123 vẫn thuộc mục /users). `badge` > 0 hiện số
 * cạnh tên (số thông báo chưa đọc).
 */
export function NavLink({
  href,
  label,
  badge = 0,
}: {
  href: string;
  label: string;
  badge?: number;
}) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
  return (
    <Link href={href} aria-current={active ? 'page' : undefined}>
      {label}
      {badge > 0 && (
        <span className="nav-badge" aria-label={`${badge} chưa đọc`}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}
