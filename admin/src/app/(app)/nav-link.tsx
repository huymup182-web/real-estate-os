'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Mục menu; đánh dấu trang đang mở (trang con như /users/123 vẫn thuộc mục /users). */
export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
  return (
    <Link href={href} aria-current={active ? 'page' : undefined}>
      {label}
    </Link>
  );
}
