'use client';
import * as React from 'react';
import { useState, useMemo } from 'react';
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
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import DeleteIcon from '@mui/icons-material/Delete';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';

interface MeterEvent {
  id: number;
  accountId: number;
  periodId: string;
  periodLabel: string;
  targetDate: string;
  notificationSent: boolean;
  status: string;
  receivedAt: string | null;
  readingsValue: string | null;
  submittedAt: string | null;
  account?: {
    accountNumber: string | null;
  };
}

interface SystemEvent {
  id: number;
  type: string;
  date: string;
  status: string;
  details: string | null;
  createdAt: string;
}

interface NotificationsData {
  meterEvents: MeterEvent[];
  systemEvents: SystemEvent[];
}

const fetcher = (url: string) => axios.get(url).then(res => res.data);

export default function NotificationsPage() {
  const [activeTab, setActiveTab] = useState(0);
  const [search, setSearch] = useState('');
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data, error, mutate, isLoading } = useSWR<NotificationsData>('/api/notifications', fetcher);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
    setSearch('');
  };

  const filteredMeterEvents = useMemo(() => {
    if (!data?.meterEvents) return [];
    return data.meterEvents.filter(item => {
      const accountMatch = item.account?.accountNumber?.toLowerCase().includes(search.toLowerCase()) ?? false;
      const periodMatch = item.periodLabel.toLowerCase().includes(search.toLowerCase());
      const statusMatch = item.status.toLowerCase().includes(search.toLowerCase());
      const readingsMatch = item.readingsValue?.toLowerCase().includes(search.toLowerCase()) ?? false;
      return accountMatch || periodMatch || statusMatch || readingsMatch;
    });
  }, [data, search]);

  const filteredSystemEvents = useMemo(() => {
    if (!data?.systemEvents) return [];
    return data.systemEvents.filter(item => {
      const typeMatch = item.type.toLowerCase().includes(search.toLowerCase());
      const detailsMatch = item.details?.toLowerCase().includes(search.toLowerCase()) ?? false;
      const statusMatch = item.status.toLowerCase().includes(search.toLowerCase());
      return typeMatch || detailsMatch || statusMatch;
    });
  }, [data, search]);

  if (isLoading) return <div className={styles.emptyState}>Загрузка уведомлений и событий...</div>;
  if (error) return <div className={styles.emptyState}>Ошибка загрузки уведомлений.</div>;

  const handleDeleteClick = (id: number) => {
    setDeleteId(id);
  };

  const handleConfirmDelete = async () => {
    if (!deleteId) return;
    try {
      await axios.delete(`/api/notifications/${deleteId}`);
      mutate();
    } catch (err: unknown) {
      alert('Ошибка при удалении записи.');
    } finally {
      setDeleteId(null);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
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

  const renderMeterStatus = (status: string) => {
    if (status === 'RECEIVED') {
      return <span className={styles.statusConfirmed}>Подано</span>;
    }
    if (status === 'PENDING') {
      return <span className={styles.statusPending}>Ожидает</span>;
    }
    return <span className={styles.statusRejected}>{status}</span>;
  };

  return (
    <div className={styles.container}>
      {/* MUI Tabs */}
      <Paper square style={{ borderRadius: '12px 12px 0 0', borderBottom: '1px solid #e2e8f0', boxShadow: 'none' }}>
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          indicatorColor="primary"
          textColor="primary"
          variant="fullWidth"
          aria-label="notifications and events tabs"
        >
          <Tab label="Подача показаний счетчиков" style={{ fontWeight: 600, padding: '16px' }} />
          <Tab label="Системный журнал событий" style={{ fontWeight: 600, padding: '16px' }} />
        </Tabs>
      </Paper>

      {/* Filters */}
      <div className={styles.filterCard} style={{ borderRadius: '0 0 12px 12px', marginTop: '-24px' }}>
        <div className={styles.searchWrapper}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder={
              activeTab === 0 
                ? "Поиск по номеру ЛС, периоду или статусу..." 
                : "Поиск по типу события, деталям или статусу..."
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          Найдено записей: {activeTab === 0 ? filteredMeterEvents.length : filteredSystemEvents.length}
        </div>
      </div>

      {/* Tab Panels */}
      {activeTab === 0 && (
        <TableContainer component={Paper} className={styles.tableCard}>
          <Table aria-label="meter events table">
            <TableHead>
              <TableRow>
                <TableCell style={{ fontWeight: 'bold' }}>ID</TableCell>
                <TableCell style={{ fontWeight: 'bold' }}>Лицевой счет</TableCell>
                <TableCell style={{ fontWeight: 'bold' }}>Период</TableCell>
                <TableCell style={{ fontWeight: 'bold' }}>Плановая дата</TableCell>
                <TableCell style={{ fontWeight: 'bold' }}>Напоминание отправлено</TableCell>
                <TableCell style={{ fontWeight: 'bold' }}>Статус</TableCell>
                <TableCell style={{ fontWeight: 'bold' }}>Показания</TableCell>
                <TableCell style={{ fontWeight: 'bold' }}>Дата отправки</TableCell>
                <TableCell style={{ fontWeight: 'bold', textAlign: 'center' }}>Действия</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredMeterEvents.length > 0 ? (
                filteredMeterEvents.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.id}</TableCell>
                    <TableCell style={{ fontWeight: 500 }}>
                      {row.account?.accountNumber || `ID: ${row.accountId}`}
                    </TableCell>
                    <TableCell style={{ fontWeight: 600 }}>{row.periodLabel}</TableCell>
                    <TableCell>{formatDate(row.targetDate)}</TableCell>
                    <TableCell>
                      {row.notificationSent ? (
                        <span className={styles.statusConfirmed}>Да</span>
                      ) : (
                        <span className={styles.statusPending}>Нет</span>
                      )}
                    </TableCell>
                    <TableCell>{renderMeterStatus(row.status)}</TableCell>
                    <TableCell style={{ fontWeight: 600 }}>{row.readingsValue || '—'}</TableCell>
                    <TableCell style={{ color: '#64748b' }}>{formatDate(row.submittedAt)}</TableCell>
                    <TableCell style={{ textAlign: 'center' }}>
                      <button
                        className={styles.rejectBtn}
                        style={{ padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        onClick={() => handleDeleteClick(row.id)}
                      >
                        <DeleteIcon style={{ fontSize: '0.9rem' }} />
                        Удалить
                      </button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={9} align="center">
                    <div className={styles.emptyState}>Записи подачи показаний не найдены</div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {activeTab === 1 && (
        <TableContainer component={Paper} className={styles.tableCard}>
          <Table aria-label="system events table">
            <TableHead>
              <TableRow>
                <TableCell style={{ fontWeight: 'bold' }}>ID</TableCell>
                <TableCell style={{ fontWeight: 'bold' }}>Тип события</TableCell>
                <TableCell style={{ fontWeight: 'bold' }}>Дата</TableCell>
                <TableCell style={{ fontWeight: 'bold' }}>Статус</TableCell>
                <TableCell style={{ fontWeight: 'bold' }}>Детали / Сообщение</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredSystemEvents.length > 0 ? (
                filteredSystemEvents.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.id}</TableCell>
                    <TableCell style={{ fontWeight: 600, color: '#4f46e5' }}>{row.type}</TableCell>
                    <TableCell style={{ color: '#64748b' }}>{formatDate(row.date)}</TableCell>
                    <TableCell>
                      {row.status === 'success' || row.status === 'confirmed' ? (
                        <span className={styles.statusConfirmed}>Успешно</span>
                      ) : (
                        <span className={styles.statusPending}>{row.status}</span>
                      )}
                    </TableCell>
                    <TableCell style={{ maxWidth: '400px', wordBreak: 'break-word' }}>
                      {row.details || '—'}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    <div className={styles.emptyState}>Системные события не найдены</div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* MUI Delete Confirmation Dialog */}
      <Dialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        aria-labelledby="delete-event-title"
        aria-describedby="delete-event-description"
      >
        <DialogTitle id="delete-event-title" style={{ fontWeight: 700 }}>
          Подтверждение удаления события счетчика
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-event-description">
            Вы действительно хотите удалить эту запись о подаче показаний счетчиков? Запись будет удалена безвозвратно.
          </DialogContentText>
        </DialogContent>
        <DialogActions style={{ padding: '16px 24px' }}>
          <Button onClick={() => setDeleteId(null)} variant="outlined" style={{ color: '#475569', borderColor: '#cbd5e1', textTransform: 'none' }}>
            Отмена
          </Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained" style={{ textTransform: 'none', backgroundColor: '#ef4444' }} autoFocus>
            Удалить запись
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
