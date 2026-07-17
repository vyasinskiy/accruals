'use client';
import * as React from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
import DeleteIcon from '@mui/icons-material/Delete';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';

interface Apartment {
  id: number;
  externalId: string;
  address: string | null;
  organization: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  _count?: {
    accounts: number;
  };
}

const fetcher = (url: string) => axios.get(url).then(res => res.data);

export default function ApartmentsPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [deleteId, setDeleteId] = useState<number | null>(null);
  
  const { data: apartments, error, isLoading, mutate } = useSWR<Apartment[]>('/api/apartments', fetcher);

  if (isLoading) return <div className={styles.emptyState}>Загрузка квартир...</div>;
  if (error) return <div className={styles.emptyState}>Ошибка загрузки квартир.</div>;

  const filteredApartments = apartments?.filter(item => {
    const addressMatch = item.address?.toLowerCase().includes(search.toLowerCase()) ?? false;
    const orgMatch = item.organization?.toLowerCase().includes(search.toLowerCase()) ?? false;
    const extMatch = item.externalId.toLowerCase().includes(search.toLowerCase());
    return addressMatch || orgMatch || extMatch;
  });

  const handleRowClick = (id: number) => {
    router.push(`/accounts?apartmentId=${id}`);
  };

  const handleDeleteClick = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setDeleteId(id);
  };

  const handleConfirmDelete = async () => {
    if (!deleteId) return;
    try {
      await axios.delete(`/api/apartments/${deleteId}`);
      mutate();
    } catch (err: unknown) {
      alert('Ошибка при удалении квартиры.');
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
            placeholder="Поиск по адресу, организации или внешнему ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          Найдено квартир: {filteredApartments?.length ?? 0}
        </div>
      </div>

      {/* Table */}
      <TableContainer component={Paper} className={styles.tableCard}>
        <Table aria-label="apartments table">
          <TableHead>
            <TableRow>
              <TableCell style={{ fontWeight: 'bold' }}>ID</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Внешний ID</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Адрес</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Управляющая организация</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Лицевые счета</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Дата обнаружения</TableCell>
              <TableCell style={{ fontWeight: 'bold', textAlign: 'center' }}>Действия</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredApartments && filteredApartments.length > 0 ? (
              filteredApartments.map((row) => (
                <TableRow
                  key={row.id}
                  className={styles.interactiveRow}
                  onClick={() => handleRowClick(row.id)}
                >
                  <TableCell>{row.id}</TableCell>
                  <TableCell style={{ color: '#64748b', fontSize: '0.8rem' }}>{row.externalId}</TableCell>
                  <TableCell style={{ fontWeight: 500 }}>{row.address || '—'}</TableCell>
                  <TableCell>{row.organization || '—'}</TableCell>
                  <TableCell style={{ fontWeight: 600, color: '#4f46e5' }}>
                    {row._count?.accounts ?? 0} шт.
                  </TableCell>
                  <TableCell style={{ color: '#64748b' }}>{formatDate(row.firstSeenAt)}</TableCell>
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
                <TableCell colSpan={7} align="center">
                  <div className={styles.emptyState}>Квартиры не найдены</div>
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
        aria-labelledby="delete-apartment-title"
        aria-describedby="delete-apartment-description"
      >
        <DialogTitle id="delete-apartment-title" style={{ fontWeight: 700 }}>
          Подтверждение удаления квартиры
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-apartment-description">
            Вы действительно хотите удалить эту квартиру? Удаление приведет к каскадному стиранию всех лицевых счетов, начислений, платежей и показаний счетчиков, связанных с данной квартирой. Это действие необратимо.
          </DialogContentText>
        </DialogContent>
        <DialogActions style={{ padding: '16px 24px' }}>
          <Button onClick={() => setDeleteId(null)} variant="outlined" style={{ color: '#475569', borderColor: '#cbd5e1', textTransform: 'none' }}>
            Отмена
          </Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained" style={{ textTransform: 'none', backgroundColor: '#ef4444' }} autoFocus>
            Удалить квартиру
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
