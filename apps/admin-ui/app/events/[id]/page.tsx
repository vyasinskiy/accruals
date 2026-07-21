'use client';
import * as React from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import axios from 'axios';
import styles from '../../shared-table.module.css';
import { formatFrequencyLabel, utcTimeToLocal } from '../../../lib/time-utils';
import CreateEditEventModal from '../../../components/CreateEditEventModal';

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
import EditIcon from '@mui/icons-material/Edit';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import TelegramIcon from '@mui/icons-material/Telegram';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';

interface EventTriggerItem {
  id: number;
  triggerDate: string;
  status: 'pending' | 'processed' | 'skipped';
  comment: string | null;
  processedAt: string | null;
  sentTelegramAt: string | null;
}

interface ScheduledEventDetail {
  id: number;
  title: string;
  description: string | null;
  targetType: 'general' | 'account' | 'tenant' | 'apartment';
  accountId?: number | null;
  tenantId?: number | null;
  apartmentId?: number | null;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  reminderFrequency?: 'weekly' | 'daily' | 'none';
  dayOfMonth: number;
  timeOfDay?: string;
  sendTelegram: boolean;
  telegramTemplate?: string | null;
  active: boolean;
  createdAt: string;
  account?: { accountNumber: string | null; customLabel: string | null; apartment?: { address: string | null } } | null;
  tenant?: { user?: { name: string | null }; apartment?: { address: string | null } } | null;
  apartment?: { address: string | null } | null;
  triggers: EventTriggerItem[];
}

const fetcher = (url: string) => axios.get(url).then(res => res.data);

export default function EventDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const eventId = params.id;

  const [selectedTrigger, setSelectedTrigger] = useState<EventTriggerItem | null>(null);
  const [commentInput, setCommentInput] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const { data: event, error, isLoading, mutate } = useSWR<ScheduledEventDetail>(
    `/api/events/${eventId}`,
    fetcher
  );
  const { data: accounts } = useSWR('/api/accounts', fetcher);
  const { data: tenants } = useSWR('/api/tenants', fetcher);
  const { data: apartments } = useSWR('/api/apartments', fetcher);

  if (isLoading) return <div className={styles.emptyState}>Загрузка информации о событии...</div>;
  if (error || !event) return <div className={styles.emptyState}>Событие не найдено.</div>;

  const handleOpenProcessModal = (trigger: EventTriggerItem) => {
    setSelectedTrigger(trigger);
    setCommentInput(trigger.comment || '');
  };

  const handleSaveProcess = async () => {
    if (!selectedTrigger) return;
    try {
      setIsUpdating(true);
      await axios.put(`/api/events/triggers/${selectedTrigger.id}`, {
        status: 'processed',
        comment: commentInput.trim()
      });
      setSelectedTrigger(null);
      mutate();
    } catch {
      alert('Ошибка при обновлении статуса события.');
    } finally {
      setIsUpdating(false);
    }
  };

  const formatTriggerDateTime = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString('ru-RU', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  const formatDateTime = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  const renderTargetInfo = () => {
    switch (event.targetType) {
      case 'account':
        return `Лицевой счет ${event.account?.accountNumber || ''} ${event.account?.apartment?.address ? `(${event.account.apartment.address})` : ''}`;
      case 'tenant':
        return `Арендатор ${event.tenant?.user?.name || ''} ${event.tenant?.apartment?.address ? `(${event.tenant.apartment.address})` : ''}`;
      case 'apartment':
        return `Квартира ${event.apartment?.address || ''}`;
      default:
        return 'Общее событие (без привязки к конкретному объекту)';
    }
  };

  return (
    <div className={styles.container}>
      {/* Back button and Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Button
            onClick={() => router.push('/events')}
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            style={{ color: '#475569', borderColor: '#cbd5e1', textTransform: 'none' }}
          >
            Назад к событиям
          </Button>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#0f172a', fontWeight: 800 }}>
              {event.title}
            </h2>
            <span style={{ fontSize: '0.875rem', color: '#64748b' }}>
              {renderTargetInfo()}
            </span>
          </div>
        </div>

        <Button
          onClick={() => setIsEditModalOpen(true)}
          variant="contained"
          startIcon={<EditIcon />}
          style={{ textTransform: 'none', backgroundColor: '#3b82f6', fontWeight: 600 }}
        >
          Редактировать событие
        </Button>
      </div>

      {/* Metadata Card */}
      <Paper className={styles.tableCard} style={{ padding: '24px', marginBottom: '24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
          <div>
            <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Периодичность</span>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a', marginTop: '4px' }}>
              {formatFrequencyLabel(event.frequency, event.dayOfMonth, event.timeOfDay)}
            </div>
          </div>

          <div>
            <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Публикация в Telegram</span>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {event.sendTelegram ? (
                <>
                  <TelegramIcon style={{ color: '#0284c7' }} />
                  <span style={{ color: '#0284c7' }}>Включена</span>
                </>
              ) : (
                <span style={{ color: '#64748b' }}>Отключена</span>
              )}
            </div>
          </div>

          <div>
            <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>Описание</span>
            <div style={{ fontSize: '0.95rem', color: '#334155', marginTop: '4px' }}>
              {event.description || 'Описание не указано'}
            </div>
          </div>
        </div>
      </Paper>

      {/* Triggers History Header */}
      <div style={{ marginBottom: '16px' }}>
        <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#0f172a', fontWeight: 700 }}>
          Даты срабатывания и история обработки
        </h3>
      </div>

      {/* Triggers History Table */}
      <TableContainer component={Paper} className={styles.tableCard}>
        <Table aria-label="event triggers table">
          <TableHead>
            <TableRow>
              <TableCell style={{ fontWeight: 'bold' }}>Дата срабатывания</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Статус</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Комментарий</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Дата обработки</TableCell>
              <TableCell style={{ fontWeight: 'bold', textAlign: 'center' }}>Действие</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {event.triggers && event.triggers.length > 0 ? (
              event.triggers.map((trigger) => (
                <TableRow key={trigger.id}>
                  <TableCell style={{ fontWeight: 700, color: '#0f172a' }}>
                    {formatTriggerDateTime(trigger.triggerDate)}
                  </TableCell>
                  <TableCell>
                    {trigger.status === 'processed' ? (
                      <span className={styles.statusConfirmed}>Обработано</span>
                    ) : new Date(trigger.triggerDate) <= new Date() ? (
                      <span className={styles.statusPending} style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>Пропущенное</span>
                    ) : (
                      <span style={{ backgroundColor: '#e0f2fe', color: '#0369a1', padding: '4px 10px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 600 }}>Запланировано</span>
                    )}
                  </TableCell>
                  <TableCell style={{ color: '#334155', maxWidth: '300px' }}>
                    {trigger.comment ? (
                      <span style={{ backgroundColor: '#f1f5f9', padding: '4px 8px', borderRadius: '4px', fontSize: '0.85rem' }}>
                        {trigger.comment}
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>—</span>
                    )}
                  </TableCell>
                  <TableCell style={{ color: '#64748b' }}>
                    {trigger.processedAt ? formatDateTime(trigger.processedAt) : '—'}
                  </TableCell>
                  <TableCell style={{ textAlign: 'center' }}>
                    {trigger.status === 'pending' ? (
                      <Button
                        onClick={() => handleOpenProcessModal(trigger)}
                        variant="contained"
                        size="small"
                        startIcon={<CheckCircleIcon />}
                        style={{ textTransform: 'none', backgroundColor: '#10b981', fontWeight: 600 }}
                      >
                        Отметить как обработанное
                      </Button>
                    ) : (
                      <Button
                        onClick={() => handleOpenProcessModal(trigger)}
                        variant="outlined"
                        size="small"
                        style={{ textTransform: 'none', color: '#475569', borderColor: '#cbd5e1' }}
                      >
                        Редактировать комментарий
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} align="center">
                  <div className={styles.emptyState}>Даты срабатывания не найдены.</div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Process Event Trigger Modal Dialog */}
      <Dialog
        open={selectedTrigger !== null}
        onClose={() => setSelectedTrigger(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle style={{ fontWeight: 700 }}>
          {selectedTrigger?.status === 'processed' ? 'Редактирование комментария' : 'Отметить событие как обработанное'}
        </DialogTitle>
        <DialogContent>
          <div style={{ marginTop: '8px' }}>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px', color: '#334155' }}>
              Комментарий / Описание результатов обработки:
            </label>
            <textarea
              placeholder="Укажите комментарий (например: Показания сняты и переданы в управляющую компанию)..."
              value={commentInput}
              onChange={(e) => setCommentInput(e.target.value)}
              className={styles.searchInput}
              style={{ width: '100%', height: '90px', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', resize: 'vertical' }}
            />
          </div>
        </DialogContent>
        <DialogActions style={{ padding: '16px 24px' }}>
          <Button onClick={() => setSelectedTrigger(null)} variant="outlined" disabled={isUpdating} style={{ color: '#475569', borderColor: '#cbd5e1', textTransform: 'none' }}>
            Отмена
          </Button>
          <Button onClick={handleSaveProcess} variant="contained" disabled={isUpdating} style={{ textTransform: 'none', backgroundColor: '#10b981', fontWeight: 600 }}>
            {isUpdating ? 'Сохранение...' : 'Сохранить и обработать'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Event Modal Dialog */}
      <CreateEditEventModal
        open={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSuccess={() => mutate()}
        accounts={accounts}
        tenants={tenants}
        apartments={apartments}
        eventToEdit={event}
      />
    </div>
  );
}
