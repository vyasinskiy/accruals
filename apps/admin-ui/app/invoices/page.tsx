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
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import DeleteIcon from '@mui/icons-material/Delete';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';

interface Invoice {
  id: number;
  accountId: number;
  accountExternalId: string;
  periodId: string;
  periodLabel: string;
  amount: string | number | null;
  invoiceUrl: string | null;
  available: boolean;
  uploadedToS3: boolean;
  firstSeenAt: string;
  account?: {
    accountNumber: string | null;
    accountLabel: string | null;
  };
}

const fetcher = (url: string) => axios.get(url).then(res => res.data);

export default function InvoicesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const accountIdParam = searchParams.get('accountId');
  const [search, setSearch] = useState('');
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const apiUrl = accountIdParam
    ? `/api/invoices?accountId=${accountIdParam}`
    : '/api/invoices';

  const { data: invoices, error, isLoading, mutate } = useSWR<Invoice[]>(apiUrl, fetcher);

  const filteredInvoices = useMemo(() => {
    if (!invoices) return [];
    return invoices.filter(item => {
      const periodIdMatch = item.periodId.toLowerCase().includes(search.toLowerCase());
      const periodLabelMatch = item.periodLabel.toLowerCase().includes(search.toLowerCase());
      const accountNumMatch = item.account?.accountNumber?.toLowerCase().includes(search.toLowerCase()) ?? false;
      return periodIdMatch || periodLabelMatch || accountNumMatch;
    });
  }, [invoices, search]);

  if (isLoading) return <div className={styles.emptyState}>Загрузка начислений...</div>;
  if (error) return <div className={styles.emptyState}>Ошибка загрузки начислений.</div>;

  const handleClearFilter = () => {
    router.push('/invoices');
  };

  const handleDeleteClick = (id: number) => {
    setDeleteId(id);
  };

  const handleConfirmDelete = async () => {
    if (!deleteId) return;
    try {
      await axios.delete(`/api/invoices/${deleteId}`);
      mutate();
    } catch (err: unknown) {
      alert('Ошибка при удалении начисления.');
    } finally {
      setDeleteId(null);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
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
            placeholder="Поиск по периоду или номеру ЛС..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {accountIdParam && (
          <div className={styles.activeFilterBadge}>
            <span>Показаны счета ЛС #{accountIdParam}</span>
            <button className={styles.clearFilterBtn} onClick={handleClearFilter} title="Сбросить фильтр">
              <CloseIcon style={{ fontSize: '1rem' }} />
            </button>
          </div>
        )}

        <div>
          Найдено начислений: {filteredInvoices.length}
        </div>
      </div>

      {/* Table */}
      <TableContainer component={Paper} className={styles.tableCard}>
        <Table aria-label="invoices table">
          <TableHead>
            <TableRow>
              <TableCell style={{ fontWeight: 'bold' }}>ID</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Номер ЛС</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Период</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Сумма</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Статус S3</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Дата обнаружения</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Действия</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredInvoices.length > 0 ? (
              filteredInvoices.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.id}</TableCell>
                  <TableCell style={{ fontWeight: 500 }}>
                    {row.account?.accountNumber || row.accountExternalId}
                  </TableCell>
                  <TableCell style={{ fontWeight: 600 }}>{row.periodLabel}</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>
                    {row.amount !== null ? `${Number(row.amount).toFixed(2)} руб.` : '—'}
                  </TableCell>
                  <TableCell>
                    {row.uploadedToS3 ? (
                      <span className={styles.statusConfirmed}>Загружен в S3</span>
                    ) : (
                      <span className={styles.statusPending}>Локально / Ожидает</span>
                    )}
                  </TableCell>
                  <TableCell style={{ color: '#64748b' }}>{formatDate(row.firstSeenAt)}</TableCell>
                  <TableCell>
                    <div className={styles.actionsCell}>
                      {row.uploadedToS3 ? (
                        <a
                          href={`/api/invoices/${row.id}/download`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.downloadLink}
                        >
                          <CloudDownloadIcon style={{ fontSize: '1rem' }} />
                          PDF
                        </a>
                      ) : (
                        <span className={`${styles.downloadLink} ${styles.disabledLink}`}>
                          Недоступно
                        </span>
                      )}
                      <button
                        className={styles.rejectBtn}
                        style={{ padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        onClick={() => handleDeleteClick(row.id)}
                      >
                        <DeleteIcon style={{ fontSize: '0.9rem' }} />
                        Удалить
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <div className={styles.emptyState}>Начисления не найдены</div>
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
        aria-labelledby="delete-invoice-title"
        aria-describedby="delete-invoice-description"
      >
        <DialogTitle id="delete-invoice-title" style={{ fontWeight: 700 }}>
          Подтверждение удаления начисления
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-invoice-description">
            Вы действительно хотите удалить это начисление? Запись будет окончательно удалена из системы. Это действие необратимо.
          </DialogContentText>
        </DialogContent>
        <DialogActions style={{ padding: '16px 24px' }}>
          <Button onClick={() => setDeleteId(null)} variant="outlined" style={{ color: '#475569', borderColor: '#cbd5e1', textTransform: 'none' }}>
            Отмена
          </Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained" style={{ textTransform: 'none', backgroundColor: '#ef4444' }} autoFocus>
            Удалить начисление
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
