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

interface AccountItem {
  id: number;
  accountNumber: string | null;
  accountLabel: string | null;
  customLabel: string | null;
  apartment?: {
    id: number;
    address: string | null;
  } | null;
}

interface AddInvoiceModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  accounts: AccountItem[] | undefined;
  initialAccountId?: string;
}

export default React.memo(function AddInvoiceModal({
  open,
  onClose,
  onSuccess,
  accounts,
  initialAccountId
}: AddInvoiceModalProps) {
  const [accountId, setAccountId] = useState<string>('');
  const [period, setPeriod] = useState<string>(() => {
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${now.getFullYear()}-${m}`;
  });
  const [amount, setAmount] = useState<string>('');
  const [comment, setComment] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      if (initialAccountId) {
        setAccountId(initialAccountId);
      } else if (accounts && accounts.length > 0) {
        setAccountId(String(accounts[0].id));
      }
      setAmount('');
      setComment('');
    }
  }, [open, initialAccountId, accounts]);

  const handleSubmit = async () => {
    if (!accountId) {
      alert('Пожалуйста, выберите лицевой счет.');
      return;
    }
    if (!amount || Number(amount) <= 0) {
      alert('Пожалуйста, укажите корректную сумму начисления.');
      return;
    }
    if (!comment.trim()) {
      alert('Пожалуйста, укажите обязательное описание/комментарий счета.');
      return;
    }

    try {
      setIsSubmitting(true);
      await axios.post('/api/invoices', {
        accountId: Number(accountId),
        period,
        amount: Number(amount),
        comment: comment.trim()
      });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      alert('Ошибка при создании счета.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle style={{ fontWeight: 700 }}>
        Выставить счет вручную
      </DialogTitle>
      <DialogContent>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '8px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px', color: '#334155' }}>
              Лицевой счет и Квартира:
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px', color: '#334155' }}>
                Расчетный период:
              </label>
              <input
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className={styles.searchInput}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px', color: '#334155' }}>
                Сумма счета (руб.):
              </label>
              <input
                type="number"
                placeholder="Например: 1450.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={styles.searchInput}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '6px', color: '#334155' }}>
              Описание / Комментарий <span style={{ color: '#ef4444' }}>*</span>:
            </label>
            <textarea
              placeholder="Обязательное описание (например: Электроэнергия за июль по счетчику 452 кВт*ч)..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className={styles.searchInput}
              style={{ width: '100%', height: '80px', padding: '10px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', resize: 'vertical' }}
            />
          </div>
        </div>
      </DialogContent>
      <DialogActions style={{ padding: '16px 24px' }}>
        <Button onClick={onClose} variant="outlined" disabled={isSubmitting} style={{ color: '#475569', borderColor: '#cbd5e1', textTransform: 'none' }}>
          Отмена
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={isSubmitting} style={{ textTransform: 'none', backgroundColor: '#4f46e5' }}>
          {isSubmitting ? 'Сохранение...' : 'Выставить счет'}
        </Button>
      </DialogActions>
    </Dialog>
  );
});
