'use client';
import * as React from 'react';
import { useState, useMemo } from 'react';
import useSWR from 'swr';
import axios from 'axios';
import styles from '../shared-table.module.css';
import { useRouter } from 'next/navigation';

// MUI Components
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import AddIcon from '@mui/icons-material/Add';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
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
    id: number;
    name: string;
  };
  apartment: {
    id: number;
    address: string | null;
  } | null;
}

interface Apartment {
  id: number;
  address: string | null;
}

const fetcher = (url: string) => axios.get(url).then(res => res.data);

export default function TenantsPage() {
  const router = useRouter();
  const { data: tenants, error, mutate, isLoading } = useSWR<Tenant[]>('/api/tenants', fetcher);
  const { data: apartments } = useSWR<Apartment[]>('/api/apartments', fetcher);

  const [search, setSearch] = useState('');
  
  // Dialog state for delete
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // Dialog state for Add/Edit
  const [formOpen, setFormOpen] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [formName, setFormName] = useState('');
  const [formApartmentId, setFormApartmentId] = useState<string>('');
  const [formRentPaymentDay, setFormRentPaymentDay] = useState<string>('20');
  const [formRentAmount, setFormRentAmount] = useState<string>('');
  const [formStatus, setFormStatus] = useState<string>('active');

  const filteredTenants = useMemo(() => {
    if (!tenants) return [];
    return tenants.filter(item => {
      const nameMatch = item.user?.name?.toLowerCase().includes(search.toLowerCase()) ?? false;
      const addressMatch = item.apartment?.address?.toLowerCase().includes(search.toLowerCase()) ?? false;
      const statusMatch = item.status.toLowerCase().includes(search.toLowerCase());
      return nameMatch || addressMatch || statusMatch;
    });
  }, [tenants, search]);

  if (isLoading) return <div className={styles.emptyState}>Загрузка арендаторов...</div>;
  if (error) return <div className={styles.emptyState}>Ошибка загрузки арендаторов.</div>;

  // Open Add Dialog
  const handleAddClick = () => {
    setEditingTenant(null);
    setFormName('');
    setFormApartmentId('');
    setFormRentPaymentDay('20');
    setFormRentAmount('');
    setFormStatus('active');
    setFormOpen(true);
  };

  // Open Edit Dialog
  const handleEditClick = (tenant: Tenant) => {
    setEditingTenant(tenant);
    setFormName(tenant.user?.name || '');
    setFormApartmentId(tenant.apartmentId ? String(tenant.apartmentId) : '');
    setFormRentPaymentDay(tenant.rentPaymentDay ? String(tenant.rentPaymentDay) : '20');
    setFormRentAmount(tenant.rentAmount ? String(tenant.rentAmount) : '');
    setFormStatus(tenant.status);
    setFormOpen(true);
  };

  // Submit Add/Edit form
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
      if (editingTenant) {
        // Edit Tenant
        await axios.put(`/api/tenants/${editingTenant.id}`, payload);
      } else {
        // Add Tenant
        await axios.post('/api/tenants', payload);
      }
      mutate();
      setFormOpen(false);
    } catch (err: unknown) {
      alert('Ошибка при сохранении профиля арендатора.');
    }
  };

  // Delete Action
  const handleDeleteClick = (id: number) => {
    setDeleteId(id);
  };

  const handleConfirmDelete = async () => {
    if (!deleteId) return;
    try {
      await axios.delete(`/api/tenants/${deleteId}`);
      mutate();
    } catch (err: unknown) {
      alert('Ошибка при удалении арендатора.');
    } finally {
      setDeleteId(null);
    }
  };

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

  const renderStatus = (status: string) => {
    switch (status) {
      case 'active':
        return <span className={styles.statusConfirmed}>Активен</span>;
      case 'pending':
        return <span className={styles.statusPending}>Ожидает</span>;
      case 'rejected':
        return <span className={styles.statusRejected}>Отклонен</span>;
      default:
        return <span className={styles.statusPending}>{status}</span>;
    }
  };

  return (
    <div className={styles.container}>
      {/* Search and Filters */}
      <div className={styles.filterCard} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className={styles.searchWrapper} style={{ width: '400px', margin: 0 }}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Поиск по имени арендатора, адресу квартиры..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <button
          className={styles.downloadLink}
          style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: '6px', border: 'none', cursor: 'pointer' }}
          onClick={handleAddClick}
        >
          <AddIcon style={{ fontSize: '1.2rem' }} />
          Добавить арендатора
        </button>
      </div>

      {/* Table */}
      <TableContainer component={Paper} className={styles.tableCard}>
        <Table aria-label="tenants table">
          <TableHead>
            <TableRow>
              <TableCell style={{ fontWeight: 'bold' }}>ID</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Арендатор</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Квартира</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>День оплаты</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Сумма аренды</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Статус</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Дата создания</TableCell>
              <TableCell style={{ fontWeight: 'bold', textAlign: 'center' }}>Действия</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredTenants.length > 0 ? (
              filteredTenants.map((row) => (
                <TableRow 
                  key={row.id}
                  className={styles.interactiveRow}
                  onClick={() => router.push(`/tenants/${row.id}`)}
                >
                  <TableCell>{row.id}</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>{row.user?.name || `ID: ${row.userId}`}</TableCell>
                  <TableCell style={{ color: row.apartment?.address ? '#0f172a' : '#94a3b8' }}>
                    {row.apartment?.address || 'Не привязана'}
                  </TableCell>
                  <TableCell>
                    {row.rentPaymentDay ? `${row.rentPaymentDay}-е число` : '—'}
                  </TableCell>
                  <TableCell style={{ fontWeight: 600, color: '#4f46e5' }}>
                    {row.rentAmount ? `${Number(row.rentAmount).toFixed(2)} руб.` : '—'}
                  </TableCell>
                  <TableCell>{renderStatus(row.status)}</TableCell>
                  <TableCell style={{ color: '#64748b' }}>{formatDate(row.createdAt)}</TableCell>
                  <TableCell style={{ textAlign: 'center' }}>
                    <div className={styles.actionsCell} style={{ justifyContent: 'center' }}>
                      <button
                        className={styles.downloadLink}
                        style={{ padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none', border: 'none', cursor: 'pointer', backgroundColor: '#e2e8f0', color: '#1e293b' }}
                        onClick={(e) => { e.stopPropagation(); handleEditClick(row); }}
                      >
                        <EditIcon style={{ fontSize: '0.9rem' }} />
                        Изменить
                      </button>
                      <button
                        className={styles.rejectBtn}
                        style={{ padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        onClick={(e) => { e.stopPropagation(); handleDeleteClick(row.id); }}
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
                  <div className={styles.emptyState}>Арендаторы не найдены</div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* MUI Add / Edit Dialog Modal */}
      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        aria-labelledby="tenant-form-title"
        maxWidth="sm"
        fullWidth
      >
        <form onSubmit={handleFormSubmit}>
          <DialogTitle id="tenant-form-title" style={{ fontWeight: 700 }}>
            {editingTenant ? 'Редактирование арендатора' : 'Добавление нового арендатора'}
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
              {editingTenant ? 'Сохранить изменения' : 'Добавить арендатора'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* MUI Delete Confirmation Dialog */}
      <Dialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        aria-labelledby="delete-tenant-title"
        aria-describedby="delete-tenant-description"
      >
        <DialogTitle id="delete-tenant-title" style={{ fontWeight: 700 }}>
          Подтверждение удаления арендатора
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-tenant-description">
            Вы действительно хотите удалить этого арендатора? Профиль арендатора и связанная с ним учетная запись пользователя будут стерты из базы данных. Это действие необратимо.
          </DialogContentText>
        </DialogContent>
        <DialogActions style={{ padding: '16px 24px' }}>
          <Button onClick={() => setDeleteId(null)} variant="outlined" style={{ color: '#475569', borderColor: '#cbd5e1', textTransform: 'none' }}>
            Отмена
          </Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained" style={{ textTransform: 'none', backgroundColor: '#ef4444' }} autoFocus>
            Удалить арендатора
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
