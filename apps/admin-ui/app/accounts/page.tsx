'use client';
import * as React from 'react';
import { useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import axios from 'axios';
import styles from '../shared-table.module.css';

// MUI Components
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';

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
  _count?: {
    invoices: number;
  };
}

const fetcher = (url: string) => axios.get(url).then(res => res.data);

export default function AccountsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const apartmentIdParam = searchParams.get('apartmentId');
  const [search, setSearch] = useState('');
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const apiUrl = apartmentIdParam 
    ? `/api/accounts?apartmentId=${apartmentIdParam}` 
    : '/api/accounts';

  const { data: accounts, error, isLoading, mutate } = useSWR<Account[]>(apiUrl, fetcher);

  const filteredAccounts = useMemo(() => {
    if (!accounts) return [];
    return accounts.filter(item => {
      const numMatch = item.accountNumber?.toLowerCase().includes(search.toLowerCase()) ?? false;
      const customMatch = item.customLabel?.toLowerCase().includes(search.toLowerCase()) ?? false;
      const labelMatch = item.accountLabel?.toLowerCase().includes(search.toLowerCase()) ?? false;
      const addressMatch = item.apartment?.address?.toLowerCase().includes(search.toLowerCase()) ?? false;
      return numMatch || customMatch || labelMatch || addressMatch;
    });
  }, [accounts, search]);

  if (isLoading) return <div className={styles.emptyState}>Загрузка лицевых счетов...</div>;
  if (error) return <div className={styles.emptyState}>Ошибка загрузки лицевых счетов.</div>;

  const handleRowClick = (id: number) => {
    router.push(`/invoices?accountId=${id}`);
  };

  const handleClearFilter = () => {
    router.push('/accounts');
  };

  const handleDeleteClick = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setDeleteId(id);
  };

  const handleConfirmDelete = async () => {
    if (!deleteId) return;
    try {
      await axios.delete(`/api/accounts/${deleteId}`);
      mutate();
    } catch (err: unknown) {
      alert('Ошибка при удалении лицевого счета.');
    } finally {
      setDeleteId(null);
    }
  };

  return (
    <div className={styles.container}>
      {/* Search and Filters */}
      <div className={styles.filterCard}>
        <div className={styles.searchWrapper}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Поиск по номеру ЛС, названию или адресу..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        
        {apartmentIdParam && (
          <div className={styles.activeFilterBadge}>
            <span>Показаны ЛС квартиры #{apartmentIdParam}</span>
            <button className={styles.clearFilterBtn} onClick={handleClearFilter} title="Сбросить фильтр">
              <CloseIcon style={{ fontSize: '1rem' }} />
            </button>
          </div>
        )}

        <div>
          Найдено лицевых счетов: {filteredAccounts.length}
        </div>
      </div>

      {/* Table */}
      <TableContainer component={Paper} className={styles.tableCard}>
        <Table aria-label="accounts table">
          <TableHead>
            <TableRow>
              <TableCell style={{ fontWeight: 'bold' }}>ID</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Номер ЛС</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Название</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Баланс</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>День подачи показаний</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Адрес квартиры</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Инвойсы</TableCell>
              <TableCell style={{ fontWeight: 'bold', textAlign: 'center' }}>Действия</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredAccounts.length > 0 ? (
              filteredAccounts.map((row) => (
                <TableRow
                  key={row.id}
                  className={styles.interactiveRow}
                  onClick={() => handleRowClick(row.id)}
                >
                  <TableCell>{row.id}</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>{row.accountNumber || '—'}</TableCell>
                  <TableCell>{row.customLabel || row.accountLabel || '—'}</TableCell>
                  <TableCell style={{ 
                    fontWeight: 600, 
                    color: Number(row.balance) < 0 ? '#ef4444' : '#0f172a' 
                  }}>
                    {row.balance !== null ? `${Number(row.balance).toFixed(2)} руб.` : '—'}
                  </TableCell>
                  <TableCell>{row.meterSubmissionDay}-е число</TableCell>
                  <TableCell style={{ color: '#475569' }}>{row.apartment?.address || '—'}</TableCell>
                  <TableCell style={{ color: '#4f46e5', fontWeight: 600 }}>
                    {row._count?.invoices ?? 0} шт.
                  </TableCell>
                  <TableCell style={{ textAlign: 'center' }}>
                    <button
                      className={styles.rejectBtn}
                      style={{ padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      onClick={(e) => handleDeleteClick(e, row.id)}
                    >
                      <DeleteIcon style={{ fontSize: '0.9rem' }} />
                      Удалить
                    </button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <div className={styles.emptyState}>Лицевые счета не найдены</div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* MUI Delete Confirmation Dialog */}
      <Dialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        aria-labelledby="delete-account-title"
        aria-describedby="delete-account-description"
      >
        <DialogTitle id="delete-account-title" style={{ fontWeight: 700 }}>
          Подтверждение удаления лицевого счета
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-account-description">
            Вы действительно хотите удалить этот лицевой счет? Это действие приведет к удалению всех связанных с ним начислений, инвойсов и событий счетчиков. Восстановить эти данные будет невозможно.
          </DialogContentText>
        </DialogContent>
        <DialogActions style={{ padding: '16px 24px' }}>
          <Button onClick={() => setDeleteId(null)} variant="outlined" style={{ color: '#475569', borderColor: '#cbd5e1', textTransform: 'none' }}>
            Отмена
          </Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained" style={{ textTransform: 'none', backgroundColor: '#ef4444' }} autoFocus>
            Удалить счет
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
