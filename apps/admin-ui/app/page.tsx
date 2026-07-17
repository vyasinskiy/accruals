// app/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import axios from 'axios';
import styles from './page.module.css';

const fetcher = (url: string) => axios.get(url).then(res => res.data);

export default function Dashboard() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  // simple auth check – try to access protected endpoint
  useEffect(() => {
    axios.get('/api/health')
      .then(() => setAuthChecked(true))
      .catch(() => router.push('/login'));
  }, []);

  const { data, error } = useSWR(authChecked ? '/api/payments/stats' : null, fetcher);

  if (!authChecked) return <p className={styles.loading}>Loading...</p>;
  if (error) return <p className={styles.error}>Failed to load stats.</p>;

  return (
    <div className={styles.container}>
      <h1 className={styles.dashboardTitle}>Admin Dashboard</h1>
      <div className={styles.grid}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Total Payments</h2>
          <p className={styles.cardValue}>{data?.totalPayments ?? '—'}</p>
        </div>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Pending Payments</h2>
          <p className={styles.cardValuePending}>{data?.pendingPayments ?? '—'}</p>
        </div>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Upcoming Events</h2>
          <p className={styles.cardValue}>{data?.upcomingEvents ?? '—'}</p>
        </div>
      </div>
    </div>
  );
}
