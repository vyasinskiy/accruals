'use client';
import * as React from 'react';
import { useState, useEffect } from 'react';
import axios from 'axios';
import styles from '../app/shared-table.module.css';

// MUI Components
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';

import { localTimeToUtc, utcTimeToLocal } from '../lib/time-utils';

interface AccountItem {
  id: number;
  accountNumber: string | null;
  customLabel: string | null;
  accountLabel: string | null;
  apartment?: { address: string | null } | null;
}

interface TenantItem {
  id: number;
  user?: { name: string | null } | null;
  apartment?: { address: string | null } | null;
}

interface ApartmentItem {
  id: number;
  address: string | null;
}

export interface EventToEditItem {
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
}

interface CreateEditEventModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  accounts: AccountItem[] | undefined;
  tenants: TenantItem[] | undefined;
  apartments: ApartmentItem[] | undefined;
  eventToEdit?: EventToEditItem | null;
}

export default React.memo(function CreateEditEventModal({
  open,
  onClose,
  onSuccess,
  accounts,
  tenants,
  apartments,
  eventToEdit
}: CreateEditEventModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetType, setTargetType] = useState<'general' | 'account' | 'tenant' | 'apartment'>('general');
  const [accountId, setAccountId] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [apartmentId, setApartmentId] = useState('');
  const [frequency, setFrequency] = useState<'monthly' | 'quarterly'>('monthly');
  const [dayOfMonth, setDayOfMonth] = useState<number>(20);
  const [timeOfDay, setTimeOfDay] = useState<string>('10:00');
  const [sendTelegram, setSendTelegram] = useState(true);
  const [telegramTemplate, setTelegramTemplate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      if (eventToEdit) {
        setTitle(eventToEdit.title || '');
        setDescription(eventToEdit.description || '');
        setTargetType(eventToEdit.targetType || 'general');
        setAccountId(eventToEdit.accountId ? String(eventToEdit.accountId) : (accounts && accounts.length > 0 ? String(accounts[0].id) : ''));
        setTenantId(eventToEdit.tenantId ? String(eventToEdit.tenantId) : (tenants && tenants.length > 0 ? String(tenants[0].id) : ''));
        setApartmentId(eventToEdit.apartmentId ? String(eventToEdit.apartmentId) : (apartments && apartments.length > 0 ? String(apartments[0].id) : ''));
        setFrequency(eventToEdit.frequency || 'monthly');
        setDayOfMonth(eventToEdit.dayOfMonth || 20);
        setTimeOfDay(utcTimeToLocal(eventToEdit.timeOfDay));
        setSendTelegram(eventToEdit.sendTelegram ?? true);
        setTelegramTemplate(eventToEdit.telegramTemplate || '');
      } else {
        setTitle('');
        setDescription('');
        setTargetType('general');
        setAccountId(accounts && accounts.length > 0 ? String(accounts[0].id) : '');
        setTenantId(tenants && tenants.length > 0 ? String(tenants[0].id) : '');
        setApartmentId(apartments && apartments.length > 0 ? String(apartments[0].id) : '');
        setFrequency('monthly');
        setDayOfMonth(20);
        setTimeOfDay('10:00');
        setSendTelegram(true);
        setTelegramTemplate('');
      }
    }
  }, [open, eventToEdit, accounts, tenants, apartments]);

  const handleSubmit = async () => {
    if (!title.trim()) {
      alert('Пожалуйста, укажите название события.');
      return;
    }

    try {
      setIsSubmitting(true);
      const payload = {
        title: title.trim(),
        description: description.trim(),
        targetType,
        accountId: targetType === 'account' ? Number(accountId) : null,
        tenantId: targetType === 'tenant' ? Number(tenantId) : null,
        apartmentId: targetType === 'apartment' ? Number(apartmentId) : null,
        frequency,
        dayOfMonth: Number(dayOfMonth),
        timeOfDay: localTimeToUtc(timeOfDay),
        sendTelegram,
        telegramTemplate: sendTelegram ? telegramTemplate.trim() : null
      };

      if (eventToEdit) {
        await axios.put(`/api/events/${eventToEdit.id}`, payload);
      } else {
        await axios.post('/api/events', payload);
      }

      onSuccess();
      onClose();
    } catch {
      alert(`Ошибка при ${eventToEdit ? 'обновлении' : 'создании'} события.`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle style={{ fontWeight: 700 }}>
        {eventToEdit ? 'Редактировать событие' : 'Создать новое событие'}
      </DialogTitle>
      <DialogContent>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '8px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px', color: '#334155' }}>
              Название события <span style={{ color: '#ef4444' }}>*</span>:
            </label>
            <input
              type="text"
              placeholder="Например: Подача показаний счетчиков, Оплата аренды..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={styles.searchInput}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px', color: '#334155' }}>
              Описание / Детали:
            </label>
            <textarea
              placeholder="Дополнительная информация о событии..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={styles.searchInput}
              style={{ width: '100%', height: '60px', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', resize: 'vertical' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px', color: '#334155' }}>
              Привязка к объекту:
            </label>
            <select
              value={targetType}
              onChange={(e) => setTargetType(e.target.value as any)}
              className={styles.searchInput}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
            >
              <option value="general">Общее событие (без привязки)</option>
              <option value="account">Лицевой счет</option>
              <option value="tenant">Арендатор</option>
              <option value="apartment">Квартира</option>
            </select>
          </div>

          {targetType === 'account' && (
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px', color: '#334155' }}>
                Выберите лицевой счет:
              </label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className={styles.searchInput}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              >
                {accounts?.map(acc => (
                  <option key={acc.id} value={acc.id}>
                    {acc.apartment?.address ? `${acc.apartment.address} — ` : ''}ЛС {acc.accountNumber} ({acc.customLabel || acc.accountLabel || 'Услуга'})
                  </option>
                ))}
              </select>
            </div>
          )}

          {targetType === 'tenant' && (
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px', color: '#334155' }}>
                Выберите арендатора:
              </label>
              <select
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                className={styles.searchInput}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              >
                {tenants?.map(ten => (
                  <option key={ten.id} value={ten.id}>
                    {ten.user?.name || `Арендатор #${ten.id}`} {ten.apartment?.address ? `(${ten.apartment.address})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {targetType === 'apartment' && (
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px', color: '#334155' }}>
                Выберите квартиру:
              </label>
              <select
                value={apartmentId}
                onChange={(e) => setApartmentId(e.target.value)}
                className={styles.searchInput}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              >
                {apartments?.map(apt => (
                  <option key={apt.id} value={apt.id}>
                    {apt.address || `Квартира #${apt.id}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px', color: '#334155' }}>
                Периодичность:
              </label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as any)}
                className={styles.searchInput}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              >
                <option value="monthly">Каждый месяц</option>
                <option value="quarterly">Каждые 3 месяца</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px', color: '#334155' }}>
                День месяца (1-31):
              </label>
              <input
                type="number"
                min="1"
                max="31"
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Number(e.target.value))}
                className={styles.searchInput}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px', color: '#334155' }}>
                Время (ваше время):
              </label>
              <input
                type="time"
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value)}
                className={styles.searchInput}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
          </div>

          <div style={{ padding: '12px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <FormControlLabel
              control={
                <Switch
                  checked={sendTelegram}
                  onChange={(e) => setSendTelegram(e.target.checked)}
                  color="primary"
                />
              }
              label={
                <span style={{ fontWeight: 600, fontSize: '0.875rem', color: '#1e293b' }}>
                  Отправлять уведомление ботом в Telegram
                </span>
              }
            />

            {sendTelegram && (
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px', color: '#334155' }}>
                  Дополнительное сообщение / текст для Telegram:
                </label>
                <textarea
                  placeholder="Введите дополнительное примечание или текст..."
                  value={telegramTemplate}
                  onChange={(e) => setTelegramTemplate(e.target.value)}
                  className={styles.searchInput}
                  style={{ width: '100%', height: '70px', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', resize: 'vertical', fontSize: '0.85rem' }}
                />
                <span style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px', display: 'block' }}>
                  Этот текст будет встроен внутрь стандартного оформленного сообщения Telegram.
                </span>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
      <DialogActions style={{ padding: '16px 24px' }}>
        <Button onClick={onClose} variant="outlined" disabled={isSubmitting} style={{ color: '#475569', borderColor: '#cbd5e1', textTransform: 'none' }}>
          Отмена
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={isSubmitting} style={{ textTransform: 'none', backgroundColor: '#4f46e5' }}>
          {isSubmitting ? 'Сохранение...' : (eventToEdit ? 'Сохранить изменения' : 'Создать событие')}
        </Button>
      </DialogActions>
    </Dialog>
  );
});
