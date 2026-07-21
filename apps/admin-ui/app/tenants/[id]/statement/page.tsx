'use client';
import * as React from 'react';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import axios from 'axios';
import styles from '../../../shared-table.module.css';
import DateRangePicker from '../../../../components/DateRangePicker';

// MUI Components
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CloseIcon from '@mui/icons-material/Close';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';

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
    accounts?: Array<{
      id: number;
      accountNumber: string;
      accountLabel: string | null;
      customLabel: string | null;
    }>;
  } | null;
}

interface Payment {
  id: number;
  userId: number;
  amount: string | number;
  status: string;
  createdAt: string;
  comment: string | null;
}

interface Invoice {
  id: number;
  accountId: number;
  accountExternalId: string;
  periodId: string;
  periodLabel: string;
  amount: string | number | null;
  firstSeenAt: string;
  account?: {
    apartmentId: number | null;
    accountNumber: string | null;
    accountLabel: string | null;
    customLabel: string | null;
  } | null;
}

interface StatementItem {
  id: string;
  date: string;
  periodId: string;
  type: 'rent' | 'utility' | 'payment';
  description: string;
  chargeAmount: number; // Начислено (дебет)
  paymentAmount: number; // Оплачено (кредит)
  runningBalance?: number;
}

const fetcher = (url: string) => axios.get(url).then(res => res.data);

export default function TenantStatementPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const tenantId = params.id;

  const [fromMonth, setFromMonth] = useState<string>('');
  const [toMonth, setToMonth] = useState<string>('');

  const { data: tenant, isLoading: isTenantLoading } = useSWR<Tenant>(
    `/api/tenants/${tenantId}`,
    fetcher
  );

  const { data: payments } = useSWR<Payment[]>(
    tenant ? `/api/payments?userId=${tenant.userId}` : null,
    fetcher
  );

  const { data: invoices } = useSWR<Invoice[]>(
    tenant?.apartmentId ? '/api/invoices' : null,
    fetcher
  );

  // Generate consolidated statement timeline
  const statementItems = useMemo(() => {
    if (!tenant) return [];

    const items: StatementItem[] = [];

    // 1. Generate Rent Accruals
    if (tenant.rentAmount && Number(tenant.rentAmount) > 0) {
      const rentAmount = Number(tenant.rentAmount);
      const rentDay = tenant.rentPaymentDay || 1;
      const startDate = new Date(tenant.createdAt || '2026-01-01');
      const endDate = new Date(); // Current date

      const current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

      while (current <= endDate) {
        const year = current.getFullYear();
        const month = String(current.getMonth() + 1).padStart(2, '0');
        const periodId = `${year}${month}`;
        const accrualDate = new Date(year, current.getMonth(), Math.min(rentDay, 28));

        const monthName = current.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

        items.push({
          id: `rent-${periodId}`,
          date: accrualDate.toISOString(),
          periodId,
          type: 'rent',
          description: `Начисление аренды за ${monthName}`,
          chargeAmount: rentAmount,
          paymentAmount: 0
        });

        current.setMonth(current.getMonth() + 1);
      }
    }

    // 2. Add Utility Invoices
    if (invoices && tenant.apartmentId) {
      const apartmentInvoices = invoices.filter(inv => inv.account?.apartmentId === tenant.apartmentId);
      apartmentInvoices.forEach(inv => {
        const amount = Number(inv.amount || 0);
        const label = inv.account?.customLabel || inv.account?.accountLabel || `ЛС ${inv.accountExternalId}`;
        items.push({
          id: `utility-${inv.id}`,
          date: inv.firstSeenAt,
          periodId: inv.periodId || '202601',
          type: 'utility',
          description: `Коммунальные услуги: ${label} (Период: ${inv.periodLabel})`,
          chargeAmount: amount,
          paymentAmount: 0
        });
      });
    }

    // 3. Add Payments
    if (payments) {
      payments.forEach(pay => {
        const payDate = new Date(pay.createdAt);
        const year = payDate.getFullYear();
        const month = String(payDate.getMonth() + 1).padStart(2, '0');
        const periodId = `${year}${month}`;
        const amount = Number(pay.amount || 0);

        // Only count confirmed or unconfirmed payments towards ledger
        const isEffective = pay.status !== 'rejected';

        items.push({
          id: `payment-${pay.id}`,
          date: pay.createdAt,
          periodId,
          type: 'payment',
          description: `Платеж от арендатора (Статус: ${pay.status === 'confirmed' ? 'Подтвержден' : pay.status === 'rejected' ? 'Отклонен' : 'Ожидает'})${pay.comment ? ' — ' + pay.comment : ''}`,
          chargeAmount: 0,
          paymentAmount: isEffective ? amount : 0
        });
      });
    }

    // Sort chronologically ascending
    items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Calculate running balance
    let running = 0;
    return items.map(item => {
      running += (item.paymentAmount - item.chargeAmount);
      return {
        ...item,
        runningBalance: running
      };
    });
  }, [tenant, payments, invoices]);

  // Filter statement items by month range [fromMonth, toMonth]
  const filteredItems = useMemo(() => {
    return statementItems.filter(item => {
      if (fromMonth) {
        const formattedFrom = fromMonth.replace('-', '');
        if (item.periodId < formattedFrom) return false;
      }
      if (toMonth) {
        const formattedTo = toMonth.replace('-', '');
        if (item.periodId > formattedTo) return false;
      }
      return true;
    });
  }, [statementItems, fromMonth, toMonth]);

  // Totals calculations for metrics card
  const totals = useMemo(() => {
    let rentAccrued = 0;
    let utilityAccrued = 0;
    let paid = 0;

    filteredItems.forEach(item => {
      if (item.type === 'rent') rentAccrued += item.chargeAmount;
      if (item.type === 'utility') utilityAccrued += item.chargeAmount;
      if (item.type === 'payment') paid += item.paymentAmount;
    });

    const netBalance = paid - (rentAccrued + utilityAccrued);
    return { rentAccrued, utilityAccrued, totalAccrued: rentAccrued + utilityAccrued, paid, netBalance };
  }, [filteredItems]);

  if (isTenantLoading) return <div className={styles.emptyState}>Загрузка выписки арендатора...</div>;
  if (!tenant) return <div className={styles.emptyState}>Арендатор не найден.</div>;

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className={styles.container}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Button
            onClick={() => router.push(`/tenants/${tenant.id}`)}
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            style={{ color: '#475569', borderColor: '#cbd5e1', textTransform: 'none' }}
          >
            Назад к карточке
          </Button>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#0f172a', fontWeight: 800 }}>
              Полная финансовая выписка — {tenant.user?.name || `Арендатор #${tenant.id}`}
            </h2>
            <span style={{ fontSize: '0.875rem', color: '#64748b' }}>
              Квартира: {tenant.apartment?.address || 'Не привязана'}
            </span>
          </div>
        </div>
      </div>

      {/* Summary Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <Paper className={styles.tableCard} style={{ padding: '20px', borderLeft: '4px solid #6366f1' }}>
          <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>НАЧИСЛЕНО АРЕНДЫ</span>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', marginTop: '4px' }}>
            {totals.rentAccrued.toLocaleString('ru-RU')} руб.
          </div>
        </Paper>

        <Paper className={styles.tableCard} style={{ padding: '20px', borderLeft: '4px solid #f59e0b' }}>
          <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>НАЧИСЛЕНО КОММУНАЛКИ</span>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', marginTop: '4px' }}>
            {totals.utilityAccrued.toLocaleString('ru-RU')} руб.
          </div>
        </Paper>

        <Paper className={styles.tableCard} style={{ padding: '20px', borderLeft: '4px solid #10b981' }}>
          <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>ВСЕГО ОПЛАЧЕНО</span>
          <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#10b981', marginTop: '4px' }}>
            {totals.paid.toLocaleString('ru-RU')} руб.
          </div>
        </Paper>

        <Paper className={styles.tableCard} style={{ padding: '20px', borderLeft: totals.netBalance >= 0 ? '4px solid #10b981' : '4px solid #ef4444' }}>
          <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>ИТОГОВОЕ САЛЬДО</span>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: totals.netBalance >= 0 ? '#10b981' : '#ef4444', marginTop: '4px' }}>
            {totals.netBalance >= 0 ? `+${totals.netBalance.toLocaleString('ru-RU')} руб.` : `${totals.netBalance.toLocaleString('ru-RU')} руб.`}
          </div>
        </Paper>
      </div>

      {/* Date Range Filters Header */}
      <div className={styles.filterCard} style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
          {/* Unified Date Range Picker */}
          <DateRangePicker
            fromMonth={fromMonth}
            toMonth={toMonth}
            onChange={(from, to) => { setFromMonth(from); setToMonth(to); }}
            onReset={() => { setFromMonth(''); setToMonth(''); }}
          />

          {(fromMonth || toMonth) && (
            <button
              onClick={() => { setFromMonth(''); setToMonth(''); }}
              style={{
                backgroundColor: '#f1f5f9',
                border: '1px solid #cbd5e1',
                color: '#475569',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '0.875rem',
                cursor: 'pointer',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <CloseIcon style={{ fontSize: '1rem' }} />
              Сбросить период
            </button>
          )}
        </div>

        <div style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: 500 }}>
          Операций в выписке: <strong>{filteredItems.length}</strong>
        </div>
      </div>

      {/* Statement Ledger Table */}
      <TableContainer component={Paper} className={styles.tableCard}>
        <Table aria-label="statement ledger table">
          <TableHead>
            <TableRow>
              <TableCell style={{ fontWeight: 'bold' }}>Дата</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Тип операции</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Описание</TableCell>
              <TableCell style={{ fontWeight: 'bold', textAlign: 'right' }}>Начислено (-)</TableCell>
              <TableCell style={{ fontWeight: 'bold', textAlign: 'right' }}>Оплачено (+)</TableCell>
              <TableCell style={{ fontWeight: 'bold', textAlign: 'right' }}>Текущий баланс</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredItems.length > 0 ? (
              filteredItems.map((row) => (
                <TableRow key={row.id}>
                  <TableCell style={{ color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    {formatDate(row.date)}
                  </TableCell>
                  <TableCell>
                    {row.type === 'rent' ? (
                      <span className={styles.statusPending} style={{ backgroundColor: '#e0e7ff', color: '#3730a3' }}>
                        Арендная плата
                      </span>
                    ) : row.type === 'utility' ? (
                      <span className={styles.statusPending} style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
                        Коммуналка
                      </span>
                    ) : (
                      <span className={styles.statusConfirmed} style={{ backgroundColor: '#d1fae5', color: '#065f46' }}>
                        Оплата
                      </span>
                    )}
                  </TableCell>
                  <TableCell style={{ fontWeight: 500, color: '#0f172a' }}>
                    {row.description}
                  </TableCell>
                  <TableCell style={{ textAlign: 'right', fontWeight: 600, color: row.chargeAmount > 0 ? '#ef4444' : '#94a3b8' }}>
                    {row.chargeAmount > 0 ? `-${row.chargeAmount.toFixed(2)} руб.` : '—'}
                  </TableCell>
                  <TableCell style={{ textAlign: 'right', fontWeight: 600, color: row.paymentAmount > 0 ? '#10b981' : '#94a3b8' }}>
                    {row.paymentAmount > 0 ? `+${row.paymentAmount.toFixed(2)} руб.` : '—'}
                  </TableCell>
                  <TableCell style={{ textAlign: 'right', fontWeight: 700, color: (row.runningBalance ?? 0) >= 0 ? '#10b981' : '#ef4444' }}>
                    {(row.runningBalance ?? 0) >= 0
                      ? `+${(row.runningBalance ?? 0).toFixed(2)} руб.`
                      : `${(row.runningBalance ?? 0).toFixed(2)} руб.`}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <div className={styles.emptyState}>За указанный период финансовые операции отсутствуют.</div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}
