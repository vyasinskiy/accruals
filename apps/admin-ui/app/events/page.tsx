'use client';
import * as React from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import axios from 'axios';
import styles from '../shared-table.module.css';
import CreateEditEventModal from '../../components/CreateEditEventModal';

// MUI Components
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import EventIcon from '@mui/icons-material/Event';
import TelegramIcon from '@mui/icons-material/Telegram';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import { utcTimeToLocal } from '../../lib/time-utils';

interface ScheduledEventItem {
  id: number;
  title: string;
  description: string | null;
  targetType: 'general' | 'account' | 'tenant' | 'apartment';
  accountId?: number | null;
  tenantId?: number | null;
  apartmentId?: number | null;
  frequency: 'monthly' | 'quarterly';
  dayOfMonth: number;
  timeOfDay?: string;
  sendTelegram: boolean;
  telegramTemplate?: string | null;
  active: boolean;
  createdAt: string;
  account?: { accountNumber: string | null; customLabel: string | null; apartment?: { address: string | null } } | null;
  tenant?: { user?: { name: string | null }; apartment?: { address: string | null } } | null;
  apartment?: { address: string | null } | null;
  triggers?: Array<{ id: number; status: string; triggerDate: string }>;
}

const fetcher = (url: string) => axios.get(url).then(res => res.data);

export default function EventsPage() {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [eventToEdit, setEventToEdit] = useState<ScheduledEventItem | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: events, error, isLoading, mutate } = useSWR<ScheduledEventItem[]>('/api/events', fetcher);
  const { data: accounts } = useSWR('/api/accounts', fetcher);
  const { data: tenants } = useSWR('/api/tenants', fetcher);
  const { data: apartments } = useSWR('/api/apartments', fetcher);

  if (isLoading) return <div className={styles.emptyState}>Загрузка событий...</div>;
  if (error) return <div className={styles.emptyState}>Ошибка загрузки событий.</div>;

  const handleCreateClick = () => {
    setEventToEdit(null);
    setIsModalOpen(true);
  };

  const handleEditClick = (e: React.MouseEvent, eventItem: ScheduledEventItem) => {
    e.stopPropagation();
    setEventToEdit(eventItem);
    setIsModalOpen(true);
  };

  const handleDeleteClick = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setDeleteId(id);
  };

  const handleConfirmDelete = async () => {
    if (!deleteId) return;
    try {
      await axios.delete(`/api/events/${deleteId}`);
      mutate();
    } catch {
      alert('Ошибка при удалении события.');
    } finally {
      setDeleteId(null);
    }
  };

  const renderTargetLabel = (item: ScheduledEventItem) => {
    switch (item.targetType) {
      case 'account':
        return (
          <span style={{ backgroundColor: '#e0e7ff', color: '#3730a3', padding: '4px 8px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600 }}>
            ЛС: {item.account?.accountNumber || `#${item.accountId}`}
          </span>
        );
      case 'tenant':
        return (
          <span style={{ backgroundColor: '#fef3c7', color: '#92400e', padding: '4px 8px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600 }}>
            Арендатор: {item.tenant?.user?.name || `#${item.tenantId}`}
          </span>
        );
      case 'apartment':
        return (
          <span style={{ backgroundColor: '#dcfce7', color: '#166534', padding: '4px 8px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600 }}>
            Квартира: {item.apartment?.address || `#${item.apartmentId}`}
          </span>
        );
      default:
        return (
          <span style={{ backgroundColor: '#f1f5f9', color: '#475569', padding: '4px 8px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600 }}>
            Общее событие
          </span>
        );
    }
  };

  return (
    <div className={styles.container}>
      {/* Top Header Card */}
      <div className={styles.filterCard} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.4rem', color: '#0f172a', fontWeight: 800 }}>
            Управление запланированными событиями
          </h2>
          <span style={{ fontSize: '0.875rem', color: '#64748b' }}>
            Настраивайте расписание событий для квартир, арендаторов и лицевых счетов
          </span>
        </div>

        <button
          className={styles.downloadLink}
          style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: '6px', border: 'none', cursor: 'pointer', backgroundColor: '#4f46e5', color: '#fff', fontWeight: 600, borderRadius: '8px' }}
          onClick={handleCreateClick}
        >
          <AddIcon style={{ fontSize: '1.2rem' }} />
          Создать событие
        </button>
      </div>

      {/* Table of Events */}
      <TableContainer component={Paper} className={styles.tableCard}>
        <Table aria-label="events table">
          <TableHead>
            <TableRow>
              <TableCell style={{ fontWeight: 'bold' }}>ID</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Название и описание</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Привязка к объекту</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Периодичность</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Уведомление в TG</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Ближайшие срабатывания</TableCell>
              <TableCell style={{ fontWeight: 'bold', textAlign: 'center' }}>Действия</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {events && events.length > 0 ? (
              events.map((row) => {
                const pendingCount = row.triggers?.filter(t => t.status === 'pending' && new Date(t.triggerDate) <= new Date()).length || 0;
                return (
                  <TableRow
                    key={row.id}
                    className={styles.interactiveRow}
                    onClick={() => router.push(`/events/${row.id}`)}
                  >
                    <TableCell>{row.id}</TableCell>
                    <TableCell style={{ maxWidth: '260px' }}>
                      <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.95rem' }}>
                        {row.title}
                      </div>
                      {row.description && (
                        <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '2px' }}>
                          {row.description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{renderTargetLabel(row)}</TableCell>
                    <TableCell style={{ fontWeight: 600, color: '#334155' }}>
                      {row.frequency === 'quarterly' ? 'Каждые 3 месяца' : 'Каждый месяц'} ({row.dayOfMonth}-го числа в {utcTimeToLocal(row.timeOfDay)})
                    </TableCell>
                    <TableCell>
                      {row.sendTelegram ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#0284c7', backgroundColor: '#e0f2fe', padding: '4px 8px', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600 }}>
                          <TelegramIcon style={{ fontSize: '1rem' }} /> Telegram
                        </span>
                      ) : (
                        <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Без отправки</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {pendingCount > 0 ? (
                        <span style={{ backgroundColor: '#fee2e2', color: '#dc2626', padding: '4px 10px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 700 }}>
                          {pendingCount} новых
                        </span>
                      ) : (
                        <span style={{ backgroundColor: '#f1f5f9', color: '#64748b', padding: '4px 10px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 600 }}>
                          Все обработаны
                        </span>
                      )}
                    </TableCell>
                    <TableCell style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                        <button
                          className={styles.downloadLink}
                          style={{ padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px', border: 'none', cursor: 'pointer', backgroundColor: '#3b82f6', color: '#fff', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600 }}
                          onClick={(e) => handleEditClick(e, row)}
                        >
                          <EditIcon style={{ fontSize: '0.9rem' }} />
                          Редактировать
                        </button>
                        <button
                          className={styles.rejectBtn}
                          style={{ padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                          onClick={(e) => handleDeleteClick(e, row.id)}
                        >
                          <DeleteIcon style={{ fontSize: '0.9rem' }} />
                          Удалить
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <div className={styles.emptyState}>События не созданы. Нажмите «Создать событие», чтобы добавить новое правило.</div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Modal Dialog for Event Creation & Editing */}
      <CreateEditEventModal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => mutate()}
        accounts={accounts}
        tenants={tenants}
        apartments={apartments}
        eventToEdit={eventToEdit}
      />

      {/* MUI Delete Confirmation Dialog */}
      <Dialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
      >
        <DialogTitle style={{ fontWeight: 700 }}>
          Подтверждение удаления события
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            Вы действительно хотите удалить это событие и всю историю его срабатываний?
          </DialogContentText>
        </DialogContent>
        <DialogActions style={{ padding: '16px 24px' }}>
          <Button onClick={() => setDeleteId(null)} variant="outlined" style={{ color: '#475569', borderColor: '#cbd5e1', textTransform: 'none' }}>
            Отмена
          </Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained" style={{ textTransform: 'none', backgroundColor: '#ef4444' }}>
            Удалить
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
