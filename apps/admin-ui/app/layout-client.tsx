'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import styles from './layout.module.css';

// MUI Icons
import DashboardIcon from '@mui/icons-material/Dashboard';
import BusinessIcon from '@mui/icons-material/Business';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import ReceiptIcon from '@mui/icons-material/Receipt';
import PaymentIcon from '@mui/icons-material/Payment';
import NotificationsIcon from '@mui/icons-material/Notifications';
import LogoutIcon from '@mui/icons-material/Logout';
import SyncIcon from '@mui/icons-material/Sync';

interface MenuItem {
  text: string;
  path: string;
  icon: React.ReactNode;
}

export default function LayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  // If we are on the login page, don't show the sidebar and layout wrapper
  if (pathname === '/login') {
    return <>{children}</>;
  }

  const menuItems: MenuItem[] = [
    { text: 'Дашборд', path: '/', icon: <DashboardIcon className={styles.menuIcon} /> },
    { text: 'Квартиры', path: '/apartments', icon: <BusinessIcon className={styles.menuIcon} /> },
    { text: 'Лицевые счета', path: '/accounts', icon: <AccountBalanceIcon className={styles.menuIcon} /> },
    { text: 'Инвойсы', path: '/invoices', icon: <ReceiptIcon className={styles.menuIcon} /> },
    { text: 'Платежи', path: '/payments', icon: <PaymentIcon className={styles.menuIcon} /> },
    { text: 'Уведомления', path: '/notifications', icon: <NotificationsIcon className={styles.menuIcon} /> },
    { text: 'Сканирование', path: '/scanning', icon: <SyncIcon className={styles.menuIcon} /> },
  ];

  const handleLogout = () => {
    // Clear cookies and push to login page
    document.cookie = 'auth=; Path=/; Max-Age=0;';
    router.push('/login');
  };

  const getPageTitle = () => {
    const activeItem = menuItems.find(item => {
      if (item.path === '/') return pathname === '/';
      return pathname.startsWith(item.path);
    });
    return activeItem ? activeItem.text : 'Панель управления';
  };

  return (
    <div className={styles.layoutContainer}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.logoArea}>
          <span className={styles.logoText}>Accruals Admin</span>
        </div>
        <nav className={styles.menuList}>
          {menuItems.map((item) => {
            const isActive = item.path === '/' 
              ? pathname === '/' 
              : pathname.startsWith(item.path);
            
            return (
              <div key={item.path} className={styles.menuItem}>
                <Link 
                  href={item.path}
                  className={`${styles.menuLink} ${isActive ? styles.activeMenuLink : ''}`}
                >
                  {item.icon}
                  <span>{item.text}</span>
                </Link>
              </div>
            );
          })}
        </nav>
      </aside>

      {/* Main Content Area */}
      <div className={styles.mainWrapper}>
        <header className={styles.header}>
          <h2 className={styles.pageTitle}>{getPageTitle()}</h2>
          <div className={styles.userInfo}>
            <span className={styles.userBadge}>Администратор</span>
            <button className={styles.logoutBtn} onClick={handleLogout}>
              <LogoutIcon style={{ fontSize: '1rem', marginRight: '4px', verticalAlign: 'middle' }} />
              Выйти
            </button>
          </div>
        </header>
        <main className={styles.contentArea}>
          {children}
        </main>
      </div>
    </div>
  );
}
