import './globals.css';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { CrashListener } from './crash-listener.tsx';

export const metadata: Metadata = {
  title: 'Quản trị · AI Real Estate OS',
  description: 'Web quản trị nội bộ của AI Real Estate OS',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <CrashListener />
        {children}
      </body>
    </html>
  );
}
