'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import axios from 'axios';
import styles from '../../shared-table.module.css';

import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PaymentIcon from '@mui/icons-material/Payment';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import BusinessIcon from '@mui/icons-material/Business';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import EditIcon from '@mui/icons-material/Edit';
import EventIcon from '@mui/icons-material/Event';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import InputLabel from '@mui/material/InputLabel';
import FormControl from '@mui/material/FormControl';

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
    organization: string | null;
  } | null;
}

interface Apartment {
  id: number;
  address: string | null;
}

const fetcher = (url: string) => axios.get(url).then(res => res.data);

export default function TenantDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const tenantId = params.id;

  const { data: tenant, error, mutate, isLoading } = useSWR<Tenant>(
    `/api/tenants/${tenantId}`,
    fetcher
  );
  const { data: apartments } = useSWR<Apartment[]>('/api/apartments', fetcher);

  // Edit Tenant Modal states
  const [formOpen, setFormOpen] = React.useState(false);
  const [formName, setFormName] = React.useState('');
  const [formApartmentId, setFormApartmentId] = React.useState<string>('');
  const [formRentPaymentDay, setFormRentPaymentDay] = React.useState<string>('20');
  const [formRentAmount, setFormRentAmount] = React.useState<string>('');
  const [formStatus, setFormStatus] = React.useState<string>('active');

  const handleEditClick = () => {
    if (!tenant) return;
    setFormName(tenant.user?.name || '');
    setFormApartmentId(tenant.apartmentId ? String(tenant.apartmentId) : '');
    setFormRentPaymentDay(tenant.rentPaymentDay ? String(tenant.rentPaymentDay) : '20');
    setFormRentAmount(tenant.rentAmount ? String(tenant.rentAmount) : '');
    setFormStatus(tenant.status || 'active');
    setFormOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      alert('Пожалуйста, введите имя арендатора.');
      return;
    }

    const payload = {
      name: formName,
      apartmentId: formApartmentId ? parseInt(formApartmentId, 10) : null,
      rentPaymentDay: formRentPaymentDay ? parseInt(formRentPaymentDay, 10) : null,
      rentAmount: formRentAmount ? parseFloat(formRentAmount) : null,
      status: formStatus,
    };

    try {
      await axios.put(`/api/tenants/${tenantId}`, payload);
      mutate();
      setFormOpen(false);
    } catch (err: unknown) {
      alert('Ошибка при сохранении профиля арендатора.');
    }
  };

  if (isLoading) return <div className={styles.emptyState}>Загрузка информации об арендаторе...</div>;
  if (error) return <div className={styles.emptyState}>Ошибка загрузки информации об арендаторе.</div>;
  if (!tenant) return <div className={styles.emptyState}>Арендатор не найден.</div>;

  const handleShowPayments = () => {
    router.push(`/payments?userId=${tenant.userId}`);
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('ru-RU', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className={styles.container}>
      {/* Header with back button & edit button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Button
            onClick={() => router.push('/tenants')}
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            style={{ color: '#475569', borderColor: '#cbd5e1', textTransform: 'none' }}
          >
            Назад к списку
          </Button>
          <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#0f172a', fontWeight: 700 }}>
            Карточка арендатора #{tenant.id}
          </h2>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <Button
            onClick={() => router.push(`/events?create=true&tenantId=${tenant.id}`)}
            variant="outlined"
            startIcon={<EventIcon />}
            style={{ borderColor: '#4f46e5', color: '#4f46e5', textTransform: 'none', fontWeight: 600 }}
          >
            Создать событие
          </Button>
          <Button
            onClick={handleEditClick}
            variant="contained"
            startIcon={<EditIcon />}
            style={{ backgroundColor: '#4f46e5', color: '#fff', textTransform: 'none', fontWeight: 600 }}
          >
            Изменить
          </Button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
        {/* Profile Card */}
        <Paper className={styles.tableCard} style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: '0.875rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                ФИО Арендатора
              </span>
              <h3 style={{ margin: '4px 0 0 0', fontSize: '1.8rem', color: '#0f172a', fontWeight: 800 }}>
                {tenant.user?.name || 'Имя не указано'}
              </h3>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div>
              <span style={{ fontSize: '0.875rem', color: '#64748b', display: 'block' }}>Арендная ставка</span>
              <strong style={{ fontSize: '1.25rem', color: '#4f46e5' }}>
                {tenant.rentAmount ? `${Number(tenant.rentAmount).toLocaleString('ru-RU')} руб. / мес.` : 'Не указана'}
              </strong>
            </div>

            <div>
              <span style={{ fontSize: '0.875rem', color: '#64748b', display: 'block' }}>Расчетный день аренды</span>
              <strong style={{ fontSize: '1.25rem', color: '#0f172a' }}>
                {tenant.rentPaymentDay ? `${tenant.rentPaymentDay}-е число месяца` : 'Не указан'}
              </strong>
            </div>

            <div>
              <span style={{ fontSize: '0.875rem', color: '#64748b', display: 'block' }}>Статус договора</span>
              <span style={{ display: 'inline-block', marginTop: '4px' }}>
                {tenant.status === 'active' ? (
                  <span className={styles.statusConfirmed}>Активен</span>
                ) : tenant.status === 'pending' ? (
                  <span className={styles.statusPending}>Ожидает</span>
                ) : (
                  <span className={styles.statusRejected}>{tenant.status}</span>
                )}
              </span>
            </div>

            <div>
              <span style={{ fontSize: '0.875rem', color: '#64748b', display: 'block' }}>Дата регистрации</span>
              <strong style={{ fontSize: '1.1rem', color: '#334155', fontWeight: 500 }}>
                {formatDate(tenant.createdAt)}
              </strong>
            </div>
          </div>

          <hr style={{ border: '0', borderTop: '1px solid #f1f5f9', margin: '12px 0' }} />

          {/* Linked Apartment Card */}
          <div>
            <h4 style={{ margin: '0 0 12px 0', fontSize: '1.1rem', color: '#0f172a', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BusinessIcon style={{ color: '#64748b' }} />
              Привязанное помещение
            </h4>
            {tenant.apartment ? (
              <div style={{ backgroundColor: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <p style={{ margin: '0 0 8px 0', fontWeight: 600, color: '#1e293b' }}>
                  {tenant.apartment.address}
                </p>
                <p style={{ margin: 0, fontSize: '0.875rem', color: '#64748b' }}>
                  Управляющая организация: {tenant.apartment.organization || 'Не указана'}
                </p>
              </div>
            ) : (
              <p style={{ margin: 0, color: '#94a3b8', fontStyle: 'italic' }}>
                Квартира еще не привязана к данному арендатору. Вы можете сделать это, нажав кнопку «Изменить».
              </p>
            )}
          </div>
        </Paper>

        {/* Quick Actions Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Paper className={styles.tableCard} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '1rem', color: '#0f172a', fontWeight: 700 }}>
              Действия с арендатором
            </h4>

            <Button
              onClick={handleEditClick}
              variant="outlined"
              fullWidth
              startIcon={<EditIcon />}
              style={{
                color: '#1e293b',
                borderColor: '#cbd5e1',
                backgroundColor: '#f8fafc',
                textTransform: 'none',
                padding: '12px',
                fontWeight: 600,
                fontSize: '0.95rem'
              }}
            >
              Изменить арендатора
            </Button>

            <Button
              onClick={handleShowPayments}
              variant="contained"
              fullWidth
              startIcon={<PaymentIcon />}
              style={{
                backgroundColor: '#4f46e5',
                color: '#fff',
                textTransform: 'none',
                padding: '12px',
                fontWeight: 600,
                fontSize: '0.95rem'
              }}
            >
              Показать платежи
            </Button>

            <Button
              onClick={() => {
                if (tenant.apartmentId) {
                  router.push(`/accounts?apartmentId=${tenant.apartmentId}`);
                } else {
                  alert('У этого арендатора нет привязанной квартиры.');
                }
              }}
              variant="outlined"
              fullWidth
              startIcon={<AccountBalanceIcon />}
              style={{
                color: '#4f46e5',
                borderColor: '#c7d2fe',
                textTransform: 'none',
                padding: '12px',
                fontWeight: 600,
                fontSize: '0.95rem'
              }}
              disabled={!tenant.apartmentId}
            >
              Лицевые счета
            </Button>

            <Button
              onClick={() => {
                if (tenant.apartmentId) {
                  router.push(`/invoices?create=true&apartmentId=${tenant.apartmentId}&tenantId=${tenant.id}`);
                } else {
                  router.push('/invoices?create=true');
                }
              }}
              variant="contained"
              fullWidth
              startIcon={<PaymentIcon />}
              style={{
                backgroundColor: '#10b981',
                color: '#fff',
                textTransform: 'none',
                padding: '12px',
                fontWeight: 600,
                fontSize: '0.95rem'
              }}
            >
              Выставить счет
            </Button>

            <Button
              onClick={() => router.push(`/tenants/${tenant.id}/statement`)}
              variant="outlined"
              fullWidth
              startIcon={<ReceiptLongIcon />}
              style={{
                color: '#0369a1',
                borderColor: '#bae6fd',
                backgroundColor: '#f0f9ff',
                textTransform: 'none',
                padding: '12px',
                fontWeight: 600,
                fontSize: '0.95rem'
              }}
            >
              Полная выписка
            </Button>
          </Paper>
        </div>
      </div>

      {/* MUI Edit Tenant Dialog Modal */}
      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        aria-labelledby="tenant-edit-title"
        maxWidth="sm"
        fullWidth
      >
        <form onSubmit={handleFormSubmit}>
          <DialogTitle id="tenant-edit-title" style={{ fontWeight: 700 }}>
            Редактирование арендатора
          </DialogTitle>
          <DialogContent style={{ display: 'flex', flexDirection: 'column', gap: '16px', paddingTop: '8px' }}>
            <TextField
              label="ФИО Арендатора"
              fullWidth
              required
              variant="outlined"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />

            <FormControl fullWidth variant="outlined">
              <InputLabel id="select-apartment-label">Квартира</InputLabel>
              <Select
                labelId="select-apartment-label"
                id="select-apartment"
                value={formApartmentId}
                onChange={(e) => setFormApartmentId(e.target.value as string)}
                label="Квартира"
              >
                <MenuItem value="">
                  <em>Не привязана</em>
                </MenuItem>
                {apartments?.map((apt) => (
                  <MenuItem key={apt.id} value={String(apt.id)}>
                    {apt.address}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="Сумма аренды (руб.)"
              type="number"
              fullWidth
              variant="outlined"
              value={formRentAmount}
              onChange={(e) => setFormRentAmount(e.target.value)}
              inputProps={{ min: "0", step: "0.01" }}
            />

            <TextField
              label="День оплаты аренды (число месяца)"
              type="number"
              fullWidth
              variant="outlined"
              value={formRentPaymentDay}
              onChange={(e) => setFormRentPaymentDay(e.target.value)}
              inputProps={{ min: "1", max: "31" }}
            />

            <FormControl fullWidth variant="outlined">
              <InputLabel id="select-status-label">Статус</InputLabel>
              <Select
                labelId="select-status-label"
                id="select-status"
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value as string)}
                label="Статус"
              >
                <MenuItem value="active">Активен</MenuItem>
                <MenuItem value="pending">Ожидает</MenuItem>
                <MenuItem value="rejected">Отклонен</MenuItem>
              </Select>
            </FormControl>
          </DialogContent>
          <DialogActions style={{ padding: '16px 24px' }}>
            <Button onClick={() => setFormOpen(false)} variant="outlined" style={{ color: '#475569', borderColor: '#cbd5e1', textTransform: 'none' }}>
              Отмена
            </Button>
            <Button type="submit" variant="contained" style={{ textTransform: 'none', backgroundColor: '#4f46e5' }}>
              Сохранить изменения
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </div>
  );
}
