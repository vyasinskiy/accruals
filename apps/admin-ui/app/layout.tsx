// app/layout.tsx
import type { ReactNode } from 'react';
import './globals.css';
import styles from './layout.module.css';

export const metadata = {
  title: 'Accruals Admin',
  description: 'Admin panel for managing payments and events',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={styles.body}>
        {children}
      </body>
    </html>
  );
}
