'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import axios from 'axios';
import styles from '../../shared-table.module.css';

// MUI Components
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PaymentIcon from '@mui/icons-material/Payment';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import BusinessIcon from '@mui/icons-material/Business';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';

interface Tenant {
  id: number;
  userId: number;
  apartmentId: number | null;
  rentPaymentDay: number | null;
  rentAmount: string | number | null;
  status: string;
  createdAt: string;
  user: {
    name: string;
  };
  apartment: {
    id: number;
    address: string | null;
    organization: string | null;
  } | null;
}

const fetcher = (url: string) => axios.get(url).then(res => res.data);

export default function TenantDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const tenantId = params.id;

  const { data: tenant, error, isLoading } = useSWR<Tenant>(
    `/api/tenants/${tenantId}`,
    fetcher
  );

  if (isLoading) return <div className={styles.emptyState}>Загрузка информации об арендаторе...</div>;
  if (error) return <div className={styles.emptyState}>Ошибка загрузки информации об арендаторе.</div>;
  if (!tenant) return <div className={styles.emptyState}>Арендатор не найден.</div>;

  const handleShowPayments = () => {
    router.push(`/payments?userId=${tenant.userId}`);
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className={styles.container}>
      {/* Header with back button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
        <Button
          onClick={() => router.push('/tenants')}
          variant="outlined"
          startIcon={<ArrowBackIcon />}
          style={{ color: '#475569', borderColor: '#cbd5e1', textTransform: 'none' }}
        >
          Назад к списку
        </Button>
        <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#0f172a', fontWeight: 700 }}>
          Карточка арендатора #{tenant.id}
        </h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
        {/* Profile Card */}
        <Paper className={styles.tableCard} style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div>
            <span style={{ fontSize: '0.875rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              ФИО Арендатора
            </span>
            <h3 style={{ margin: '4px 0 0 0', fontSize: '1.8rem', color: '#0f172a', fontWeight: 800 }}>
              {tenant.user?.name || 'Имя не указано'}
            </h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div>
              <span style={{ fontSize: '0.875rem', color: '#64748b', display: 'block' }}>Арендная ставка</span>
              <strong style={{ fontSize: '1.25rem', color: '#4f46e5' }}>
                {tenant.rentAmount ? `${Number(tenant.rentAmount).toLocaleString('ru-RU')} руб. / мес.` : 'Не указана'}
              </strong>
            </div>

            <div>
              <span style={{ fontSize: '0.875rem', color: '#64748b', display: 'block' }}>Расчетный день аренды</span>
              <strong style={{ fontSize: '1.25rem', color: '#0f172a' }}>
                {tenant.rentPaymentDay ? `${tenant.rentPaymentDay}-е число месяца` : 'Не указан'}
              </strong>
            </div>

            <div>
              <span style={{ fontSize: '0.875rem', color: '#64748b', display: 'block' }}>Статус договора</span>
              <span style={{ display: 'inline-block', marginTop: '4px' }}>
                {tenant.status === 'active' ? (
                  <span className={styles.statusConfirmed}>Активен</span>
                ) : tenant.status === 'pending' ? (
                  <span className={styles.statusPending}>Ожидает</span>
                ) : (
                  <span className={styles.statusRejected}>{tenant.status}</span>
                )}
              </span>
            </div>

            <div>
              <span style={{ fontSize: '0.875rem', color: '#64748b', display: 'block' }}>Дата регистрации</span>
              <strong style={{ fontSize: '1.1rem', color: '#334155', fontWeight: 500 }}>
                {formatDate(tenant.createdAt)}
              </strong>
            </div>
          </div>

          <hr style={{ border: '0', borderTop: '1px solid #f1f5f9', margin: '12px 0' }} />

          {/* Linked Apartment Card */}
          <div>
            <h4 style={{ margin: '0 0 12px 0', fontSize: '1.1rem', color: '#0f172a', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BusinessIcon style={{ color: '#64748b' }} />
              Привязанное помещение
            </h4>
            {tenant.apartment ? (
              <div style={{ backgroundColor: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <p style={{ margin: '0 0 8px 0', fontWeight: 600, color: '#1e293b' }}>
                  {tenant.apartment.address}
                </p>
                <p style={{ margin: 0, fontSize: '0.875rem', color: '#64748b' }}>
                  Управляющая организация: {tenant.apartment.organization || 'Не указана'}
                </p>
              </div>
            ) : (
              <p style={{ margin: 0, color: '#94a3b8', fontStyle: 'italic' }}>
                Квартира еще не привязана к данному арендатору. Вы можете сделать это, нажав кнопку «Изменить» в общем списке арендаторов.
              </p>
            )}
          </div>
        </Paper>

        {/* Quick Actions Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Paper className={styles.tableCard} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '1rem', color: '#0f172a', fontWeight: 700 }}>
              Действия с арендатором
            </h4>

            <Button
              onClick={handleShowPayments}
              variant="contained"
              fullWidth
              startIcon={<PaymentIcon />}
              style={{
                backgroundColor: '#4f46e5',
                color: '#fff',
                textTransform: 'none',
                padding: '12px',
                fontWeight: 600,
                fontSize: '0.95rem'
              }}
            >
              Показать платежи
            </Button>

            <Button
              onClick={() => {
                if (tenant.apartmentId) {
                  router.push(`/accounts?apartmentId=${tenant.apartmentId}`);
                } else {
                  alert('У этого арендатора нет привязанной квартиры.');
                }
              }}
              variant="outlined"
              fullWidth
              startIcon={<AccountBalanceIcon />}
              style={{
                color: '#4f46e5',
                borderColor: '#c7d2fe',
                textTransform: 'none',
                padding: '12px',
                fontWeight: 600,
                fontSize: '0.95rem'
              }}
              disabled={!tenant.apartmentId}
            >
              Лицевые счета
            </Button>

            <Button
              onClick={() => {
                if (tenant.apartmentId) {
                  router.push(`/invoices?create=true&apartmentId=${tenant.apartmentId}&tenantId=${tenant.id}`);
                } else {
                  router.push('/invoices?create=true');
                }
              }}
              variant="contained"
              fullWidth
              startIcon={<PaymentIcon />}
              style={{
                backgroundColor: '#10b981',
                color: '#fff',
                textTransform: 'none',
                padding: '12px',
                fontWeight: 600,
                fontSize: '0.95rem'
              }}
            >
              Выставить счет
            </Button>

            <Button
              onClick={() => router.push(`/tenants/${tenant.id}/statement`)}
              variant="outlined"
              fullWidth
              startIcon={<ReceiptLongIcon />}
              style={{
                color: '#0369a1',
                borderColor: '#bae6fd',
                backgroundColor: '#f0f9ff',
                textTransform: 'none',
                padding: '12px',
                fontWeight: 600,
                fontSize: '0.95rem'
              }}
            >
              Полная выписка
            </Button>
          </Paper>
        </div>
      </div>
    </div>
  );
}
