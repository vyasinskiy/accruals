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
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import DeleteIcon from '@mui/icons-material/Delete';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';

interface Payment {
  id: number;
  userId: number;
  userName: string | null;
  amount: string | number;
  receiptPhotoId: string | null;
  status: string; // unconfirmed, confirmed, rejected
  createdAt: string;
  confirmedAt: string | null;
  comment: string | null;
  user?: {
    name: string | null;
  };
}

const fetcher = (url: string) => axios.get(url).then(res => res.data);

export default function PaymentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const userIdParam = searchParams.get('userId');
  const [search, setSearch] = useState('');
  const [deleteId, setDeleteId] = useState<number | null>(null);
  
  // Modal states
  const [selectedReceipt, setSelectedReceipt] = useState<string | null>(null);
  const [rejectPaymentId, setRejectPaymentId] = useState<number | null>(null);
  const [rejectComment, setRejectComment] = useState('');

  const apiUrl = userIdParam
    ? `/api/payments?userId=${userIdParam}`
    : '/api/payments';

  const { data: payments, error, mutate, isLoading } = useSWR<Payment[]>(apiUrl, fetcher);

  const filteredPayments = useMemo(() => {
    if (!payments) return [];
    return payments.filter(item => {
      const nameMatch = item.userName?.toLowerCase().includes(search.toLowerCase()) ?? false;
      const statusMatch = item.status.toLowerCase().includes(search.toLowerCase());
      const commentMatch = item.comment?.toLowerCase().includes(search.toLowerCase()) ?? false;
      return nameMatch || statusMatch || commentMatch;
    });
  }, [payments, search]);

  if (isLoading) return <div className={styles.emptyState}>Загрузка платежей...</div>;
  if (error) return <div className={styles.emptyState}>Ошибка загрузки платежей.</div>;

  const handleConfirm = async (paymentId: number) => {
    if (!confirm('Вы действительно хотите подтвердить этот платеж?')) return;
    try {
      await axios.post('/api/payments', { action: 'confirm', paymentId });
      mutate();
    } catch (err: unknown) {
      alert('Ошибка при подтверждении платежа.');
    }
  };

  const handleOpenReject = (paymentId: number) => {
    setRejectPaymentId(paymentId);
    setRejectComment('');
  };

  const handleRejectSubmit = async () => {
    if (!rejectPaymentId) return;
    try {
      await axios.post('/api/payments', { 
        action: 'reject', 
        paymentId: rejectPaymentId, 
        comment: rejectComment 
      });
      setRejectPaymentId(null);
      mutate();
    } catch (err: unknown) {
      alert('Ошибка при отклонении платежа.');
    }
  };

  const handleDeleteClick = (id: number) => {
    setDeleteId(id);
  };

  const handleConfirmDelete = async () => {
    if (!deleteId) return;
    try {
      await axios.delete(`/api/payments/${deleteId}`);
      mutate();
    } catch (err: unknown) {
      alert('Ошибка при удалении платежа.');
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

  const renderStatus = (status: string) => {
    switch (status) {
      case 'confirmed':
        return (
          <span className={styles.statusConfirmed}>
            <CheckCircleIcon style={{ fontSize: '0.9rem', marginRight: '4px', verticalAlign: 'middle' }} />
            Подтвержден
          </span>
        );
      case 'rejected':
        return (
          <span className={styles.statusRejected}>
            <CancelIcon style={{ fontSize: '0.9rem', marginRight: '4px', verticalAlign: 'middle' }} />
            Отклонен
          </span>
        );
      default:
        return (
          <span className={styles.statusPending}>
            <HourglassEmptyIcon style={{ fontSize: '0.9rem', marginRight: '4px', verticalAlign: 'middle' }} />
            Ожидает проверки
          </span>
        );
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
            placeholder="Поиск по имени пользователя или статусу..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {userIdParam && (
          <div className={styles.activeFilterBadge}>
            <span>Показаны платежи пользователя #{userIdParam}</span>
            <button className={styles.clearFilterBtn} onClick={() => router.push('/payments')} title="Сбросить фильтр">
              <CloseIcon style={{ fontSize: '1rem' }} />
            </button>
          </div>
        )}

        <div>
          Найдено платежей: {filteredPayments.length}
        </div>
      </div>

      {/* Table */}
      <TableContainer component={Paper} className={styles.tableCard}>
        <Table aria-label="payments table">
          <TableHead>
            <TableRow>
              <TableCell style={{ fontWeight: 'bold' }}>ID</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Пользователь</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Сумма</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Чек</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Статус</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Дата отправки</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Комментарий</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Действия</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredPayments.length > 0 ? (
              filteredPayments.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.id}</TableCell>
                  <TableCell style={{ fontWeight: 500 }}>
                    {row.userName || `User ID: ${row.userId}`}
                  </TableCell>
                  <TableCell style={{ fontWeight: 600 }}>
                    {Number(row.amount).toFixed(2)} руб.
                  </TableCell>
                  <TableCell>
                    {row.receiptPhotoId ? (
                      <img
                        src={`/api/payments/receipt?fileId=${row.receiptPhotoId}`}
                        alt="Чек"
                        className={styles.receiptThumbnail}
                        onClick={() => setSelectedReceipt(row.receiptPhotoId)}
                      />
                    ) : (
                      <span style={{ color: '#94a3b8' }}>Нет чека</span>
                    )}
                  </TableCell>
                  <TableCell>{renderStatus(row.status)}</TableCell>
                  <TableCell style={{ color: '#64748b' }}>{formatDate(row.createdAt)}</TableCell>
                  <TableCell style={{ color: '#475569', maxWidth: '200px', wordBreak: 'break-word' }}>
                    {row.comment || '—'}
                  </TableCell>
                  <TableCell>
                    <div className={styles.actionsCell}>
                      {row.status === 'unconfirmed' && (
                        <>
                          <button 
                            className={styles.confirmBtn}
                            onClick={() => handleConfirm(row.id)}
                          >
                            Подтвердить
                          </button>
                          <button 
                            className={styles.rejectBtn}
                            onClick={() => handleOpenReject(row.id)}
                          >
                            Отклонить
                          </button>
                        </>
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
                <TableCell colSpan={8} align="center">
                  <div className={styles.emptyState}>Платежи не найдены</div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Full Screen Image Modal */}
      {selectedReceipt && (
        <div className={styles.modalOverlay} onClick={() => setSelectedReceipt(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>Просмотр чека об оплате</span>
              <button className={styles.modalCloseBtn} onClick={() => setSelectedReceipt(null)}>
                <CloseIcon />
              </button>
            </div>
            <div className={styles.modalBody}>
              <img
                src={`/api/payments/receipt?fileId=${selectedReceipt}`}
                alt="Чек крупно"
                className={styles.largeReceiptImage}
              />
            </div>
          </div>
        </div>
      )}

      {/* Reject Comment Dialog */}
      {rejectPaymentId && (
        <div className={styles.modalOverlay} onClick={() => setRejectPaymentId(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>Причина отклонения платежа</span>
              <button className={styles.modalCloseBtn} onClick={() => setRejectPaymentId(null)}>
                <CloseIcon />
              </button>
            </div>
            <div className={styles.modalBody} style={{ alignItems: 'stretch' }}>
              <p style={{ margin: '0 0 8px 0', fontSize: '0.875rem', color: '#475569' }}>
                Пожалуйста, укажите причину отклонения платежа. Арендатор получит это сообщение в Telegram-боте.
              </p>
              <textarea
                className={styles.searchInput}
                style={{ height: '80px', resize: 'vertical' }}
                placeholder="Причина отклонения (например: нечеткий снимок, сумма не совпадает)..."
                value={rejectComment}
                onChange={(e) => setRejectComment(e.target.value)}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                <button 
                  className={styles.logoutBtn}
                  style={{ border: 'none', backgroundColor: '#f1f5f9', color: '#334155' }}
                  onClick={() => setRejectPaymentId(null)}
                >
                  Отмена
                </button>
                <button 
                  className={styles.rejectBtn}
                  style={{ padding: '8px 16px', fontSize: '0.875rem' }}
                  onClick={handleRejectSubmit}
                >
                  Отклонить платеж
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MUI Delete Confirmation Dialog */}
      <Dialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        aria-labelledby="delete-payment-title"
        aria-describedby="delete-payment-description"
      >
        <DialogTitle id="delete-payment-title" style={{ fontWeight: 700 }}>
          Подтверждение удаления платежа
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-payment-description">
            Вы действительно хотите удалить этот платеж? Запись о транзакции будет безвозвратно стерта из базы данных.
          </DialogContentText>
        </DialogContent>
        <DialogActions style={{ padding: '16px 24px' }}>
          <Button onClick={() => setDeleteId(null)} variant="outlined" style={{ color: '#475569', borderColor: '#cbd5e1', textTransform: 'none' }}>
            Отмена
          </Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained" style={{ textTransform: 'none', backgroundColor: '#ef4444' }} autoFocus>
            Удалить платеж
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
