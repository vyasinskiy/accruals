'use client';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import axios from 'axios';
import styles from './page.module.css';

// MUI Icons
import PaymentIcon from '@mui/icons-material/Payment';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import NotificationsIcon from '@mui/icons-material/Notifications';
import BusinessIcon from '@mui/icons-material/Business';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import ReceiptIcon from '@mui/icons-material/Receipt';

const fetcher = (url: string) => axios.get(url).then(res => res.data);

export default function Dashboard() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    axios.get('/api/health')
      .then(() => setAuthChecked(true))
      .catch(() => router.push('/login'));
  }, [router]);

  const { data, error } = useSWR(authChecked ? '/api/payments/stats' : null, fetcher);

  if (!authChecked) {
    return <div className={styles.loading}>Проверка авторизации...</div>;
  }

  if (error) {
    return <div className={styles.error}>Ошибка при загрузке статистики.</div>;
  }

  return (
    <div className={styles.container}>
      {/* Welcome Banner */}
      <section className={styles.welcomeSection}>
        <h1 className={styles.welcomeTitle}>Добро пожаловать в админ-панель</h1>
        <p className={styles.welcomeSubtitle}>
          Здесь вы можете управлять квартирами, лицевыми счетами, начислениями, подтверждать оплаты арендаторов и отслеживать события подачи показаний счетчиков.
        </p>
      </section>

      {/* Stats Cards */}
      <section className={styles.grid}>
        <Link href="/payments" className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>Всего платежей</span>
            <div className={`${styles.iconWrapper} ${styles.blueIcon}`}>
              <PaymentIcon />
            </div>
          </div>
          <div className={styles.cardValue}>{data?.totalPayments ?? '—'}</div>
        </Link>

        <Link href="/payments" className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>Ожидают подтверждения</span>
            <div className={`${styles.iconWrapper} ${styles.yellowIcon}`}>
              <HourglassEmptyIcon />
            </div>
          </div>
          <div className={styles.cardValue}>{data?.pendingPayments ?? '—'}</div>
        </Link>

        <Link href="/notifications" className={styles.card}>
          <div className={styles.cardHeader}>
            <span className={styles.cardTitle}>Предстоящие напоминания</span>
            <div className={`${styles.iconWrapper} ${styles.purpleIcon}`}>
              <NotificationsIcon />
            </div>
          </div>
          <div className={styles.cardValue}>{data?.upcomingEvents ?? '—'}</div>
        </Link>
      </section>

      {/* Quick Actions */}
      <section className={styles.quickActions}>
        <h3 className={styles.sectionTitle}>Быстрые действия</h3>
        <div className={styles.actionGrid}>
          <Link href="/apartments" className={styles.actionBtn}>
            <BusinessIcon />
            <span>Управление квартирами</span>
          </Link>
          <Link href="/accounts" className={styles.actionBtn}>
            <AccountBalanceIcon />
            <span>Лицевые счета</span>
          </Link>
          <Link href="/invoices" className={styles.actionBtn}>
            <ReceiptIcon />
            <span>Начисления & Инвойсы</span>
          </Link>
          <Link href="/payments" className={styles.actionBtn}>
            <PaymentIcon />
            <span>Подтверждение оплат</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
