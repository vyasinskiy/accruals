'use client';
import * as React from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import axios from 'axios';
import styles from '../../shared-table.module.css';

import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import PaymentIcon from '@mui/icons-material/Payment';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';

interface Account {
  id: number;
  externalId: string;
  apartmentId: number;
  accountNumber: string | null;
  accountLabel: string | null;
  customLabel: string | null;
  balance: string | number | null;
  meterSubmissionDay: number;
  firstSeenAt: string;
  apartment?: {
    address: string | null;
  };
}

interface Invoice {
  id: number;
  accountId: number;
  periodLabel: string;
  amount: string | number | null;
  rawJson: string | null;
  firstSeenAt: string;
  invoiceUrl: string | null;
  available: boolean;
  uploadedToS3: boolean;
}

interface Payment {
  id: number;
  userId: number;
  amount: string;
  createdAt: string;
  userName: string | null;
}

const fetcher = (url: string) => axios.get(url).then(res => res.data);

export default function AccountDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const accountId = params.id;

  const { data: account, error: accountError, mutate: mutateAccount } = useSWR<Account>(`/api/accounts/${accountId}`, fetcher);
  const { data: invoices } = useSWR<Invoice[]>(`/api/invoices?accountId=${accountId}`, fetcher);
  const { data: payments } = useSWR<Payment[]>(`/api/payments?accountId=${accountId}`, fetcher);

  const [editOpen, setEditOpen] = useState(false);
  const [formCustomLabel, setFormCustomLabel] = useState('');
  const [formSubmissionDay, setFormSubmissionDay] = useState('');

  const handleEditClick = () => {
    if (!account) return;
    setFormCustomLabel(account.customLabel || '');
    setFormSubmissionDay(String(account.meterSubmissionDay || '20'));
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    try {
      await axios.put(`/api/accounts/${accountId}`, {
        customLabel: formCustomLabel.trim() || null,
        meterSubmissionDay: parseInt(formSubmissionDay, 10) || null
      });
      mutateAccount();
      setEditOpen(false);
    } catch (err: unknown) {
      alert('Ошибка при сохранении данных счета.');
    }
  };

  if (accountError) return <div className={styles.emptyState}>Ошибка загрузки лицевого счета.</div>;
  if (!account) return <div className={styles.emptyState} style={{ display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'center' }}><CircularProgress size={24} /> Загрузка...</div>;

  const latestInvoices = invoices?.slice(0, 5) || [];
  const latestPayments = payments?.slice(0, 5) || [];

  return (
    <div className={styles.container}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Button
            onClick={() => router.push('/accounts')}
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            style={{ color: '#475569', borderColor: '#cbd5e1', textTransform: 'none' }}
          >
            Назад к списку
          </Button>
          <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#0f172a', fontWeight: 700 }}>
            Лицевой счет #{account.accountNumber || account.id}
          </h2>
        </div>

        <Button
          onClick={handleEditClick}
          variant="contained"
          startIcon={<EditIcon />}
          style={{ backgroundColor: '#4f46e5', textTransform: 'none', fontWeight: 600 }}
        >
          Редактировать
        </Button>
      </div>

      {/* Info Card */}
      <Paper style={{ padding: '24px', borderRadius: '12px', marginBottom: '32px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '24px' }}>
          <div>
            <div style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '4px' }}>Адрес</div>
            <div style={{ fontWeight: 600, color: '#0f172a' }}>{account.apartment?.address || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '4px' }}>Свое название</div>
            <div style={{ fontWeight: 600, color: '#0f172a' }}>{account.customLabel || '—'}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '4px' }}>День подачи показаний</div>
            <div style={{ fontWeight: 600, color: '#0f172a' }}>{account.meterSubmissionDay}-е число</div>
          </div>
          <div>
            <div style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '4px' }}>Баланс</div>
            <div style={{ fontWeight: 600, color: Number(account.balance) < 0 ? '#ef4444' : '#10b981' }}>
              {account.balance !== null ? `${Number(account.balance).toFixed(2)} руб.` : '—'}
            </div>
          </div>
        </div>
      </Paper>

      {/* Grid for Invoices and Payments */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '32px' }}>
        
        {/* Invoices Column */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: '#0f172a' }}>
              <ReceiptLongIcon style={{ color: '#4f46e5' }} />
              Последние начисления
            </h3>
            <Button
              onClick={() => router.push(`/invoices?accountId=${account.id}`)}
              style={{ textTransform: 'none', color: '#4f46e5', fontWeight: 600 }}
            >
              Все начисления →
            </Button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {latestInvoices.length > 0 ? latestInvoices.map((inv) => {
              let parsedComment = '';
              let parsedAmount = inv.amount;
              if (inv.rawJson) {
                try {
                  const parsed = JSON.parse(inv.rawJson);
                  parsedComment = parsed.comment || '';
                  if (!parsedAmount && parsed.amount) parsedAmount = parsed.amount;
                } catch {}
              }
              const displayAmount = parsedAmount !== null ? `${Number(parsedAmount).toFixed(2)} руб.` : '—';
              
              const isAvailable = inv.uploadedToS3 || inv.invoiceUrl || inv.available;
              
              return (
              <Paper key={inv.id} style={{ padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>Начисление за {inv.periodLabel}</div>
                    <div style={{ fontSize: '0.875rem', color: '#64748b' }}>
                      {new Date(inv.firstSeenAt).toLocaleDateString('ru-RU')}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{displayAmount}</div>
                    <div style={{ fontSize: '0.75rem', color: isAvailable ? '#10b981' : '#f59e0b', fontWeight: 600 }}>
                      {isAvailable ? 'Доступен' : 'Ожидает'}
                    </div>
                  </div>
                </div>
                {parsedComment && (
                  <div style={{ marginTop: '8px', fontSize: '0.8rem', color: '#475569', backgroundColor: '#f1f5f9', padding: '4px 8px', borderRadius: '4px' }}>
                    {parsedComment}
                  </div>
                )}
              </Paper>
            )}) : (
              <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
                Начислений пока нет
              </div>
            )}
          </div>
        </div>

        {/* Payments Column */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: '#0f172a' }}>
              <PaymentIcon style={{ color: '#10b981' }} />
              Последние оплаты
            </h3>
            <Button
              onClick={() => router.push(`/payments?accountId=${account.id}`)}
              style={{ textTransform: 'none', color: '#4f46e5', fontWeight: 600 }}
            >
              Все оплаты →
            </Button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {latestPayments.length > 0 ? latestPayments.map((pay) => (
              <Paper key={pay.id} style={{ padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>Оплата ({pay.userName || 'Неизвестно'})</div>
                    <div style={{ fontSize: '0.875rem', color: '#64748b' }}>{new Date(pay.createdAt).toLocaleDateString('ru-RU')}</div>
                  </div>
                  <div style={{ textAlign: 'right', fontWeight: 700, color: '#10b981' }}>
                    +{Number(pay.amount).toFixed(2)} руб.
                  </div>
                </div>
              </Paper>
            )) : (
              <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
                Оплат пока нет
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Edit Account Modal */}
      <Dialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle style={{ fontWeight: 700 }}>
          Редактирование лицевого счета
        </DialogTitle>
        <DialogContent style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingTop: '16px' }}>
          <TextField
            label="Свое название (custom label)"
            variant="outlined"
            fullWidth
            value={formCustomLabel}
            onChange={(e) => setFormCustomLabel(e.target.value)}
            placeholder="Например: Моя квартира"
          />
          <TextField
            label="День подачи показаний"
            type="number"
            variant="outlined"
            fullWidth
            value={formSubmissionDay}
            onChange={(e) => setFormSubmissionDay(e.target.value)}
            inputProps={{ min: 1, max: 31 }}
          />
        </DialogContent>
        <DialogActions style={{ padding: '16px 24px' }}>
          <Button onClick={() => setEditOpen(false)} variant="outlined" style={{ color: '#475569', borderColor: '#cbd5e1', textTransform: 'none' }}>
            Отмена
          </Button>
          <Button onClick={handleSaveEdit} variant="contained" style={{ textTransform: 'none', backgroundColor: '#4f46e5' }}>
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
