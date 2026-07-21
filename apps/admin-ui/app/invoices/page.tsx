'use client';
import * as React from 'react';
import { useState, useMemo, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import axios from 'axios';
import styles from '../shared-table.module.css';
import DateRangePicker from '../../components/DateRangePicker';
import AddInvoiceModal from '../../components/AddInvoiceModal';

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
import AddIcon from '@mui/icons-material/Add';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';

interface Apartment {
  id: number;
  address: string | null;
}

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
  rawJson?: string | null;
  account?: {
    accountNumber: string | null;
    accountLabel: string | null;
    customLabel: string | null;
    apartment?: {
      id: number;
      address: string | null;
    } | null;
  } | null;
}

const fetcher = (url: string) => axios.get(url).then(res => res.data);

export default function InvoicesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const accountIdParam = searchParams.get('accountId');
  
  const [search, setSearch] = useState('');
  const [selectedApartmentId, setSelectedApartmentId] = useState<string>('all');
  const [fromMonth, setFromMonth] = useState<string>('');
  const [toMonth, setToMonth] = useState<string>('');
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // Modal State for Manual Invoice
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addAccountId, setAddAccountId] = useState<string>('');

  const apiUrl = accountIdParam
    ? `/api/invoices?accountId=${accountIdParam}`
    : '/api/invoices';

  const { data: invoices, error, isLoading, mutate } = useSWR<Invoice[]>(apiUrl, fetcher);
  const { data: apartments } = useSWR<Apartment[]>('/api/apartments', fetcher);
  const { data: accounts } = useSWR<AccountItem[]>('/api/accounts', fetcher);

  const createParam = searchParams.get('create');
  const paramApartmentId = searchParams.get('apartmentId');

  useEffect(() => {
    if (createParam === 'true') {
      setIsAddModalOpen(true);
      if (accountIdParam) {
        setAddAccountId(accountIdParam);
      } else if (paramApartmentId && accounts && accounts.length > 0) {
        const matchingAcc = accounts.find(acc => acc.apartment?.id === Number(paramApartmentId));
        if (matchingAcc) {
          setAddAccountId(String(matchingAcc.id));
        }
      }
    }
  }, [createParam, accountIdParam, paramApartmentId, accounts]);

  // Memoize comment parsing so JSON.parse only runs when invoices array updates
  const processedInvoices = useMemo(() => {
    if (!invoices) return [];
    return invoices.map(item => {
      let parsedComment = '';
      if (item.rawJson) {
        try {
          const parsed = JSON.parse(item.rawJson);
          parsedComment = parsed.comment || '';
        } catch {}
      }
      return { ...item, parsedComment };
    });
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    if (!processedInvoices) return [];
    return processedInvoices.filter(item => {
      // Filter by Apartment Dropdown
      if (selectedApartmentId && selectedApartmentId !== 'all') {
        if (item.account?.apartment?.id !== Number(selectedApartmentId)) {
          return false;
        }
      }

      // Filter by Month Range (fromMonth ... toMonth)
      if (fromMonth) {
        const formattedFrom = fromMonth.replace('-', '');
        if ((item.periodId && item.periodId < formattedFrom) || (item.periodLabel && item.periodLabel < formattedFrom)) {
          return false;
        }
      }
      if (toMonth) {
        const formattedTo = toMonth.replace('-', '');
        if ((item.periodId && item.periodId > formattedTo) || (item.periodLabel && item.periodLabel > formattedTo)) {
          return false;
        }
      }

      // Text search
      if (search) {
        const periodIdMatch = item.periodId?.toLowerCase().includes(search.toLowerCase());
        const periodLabelMatch = item.periodLabel?.toLowerCase().includes(search.toLowerCase());
        const accountNumMatch = (item.account?.accountNumber || item.accountExternalId)?.toLowerCase().includes(search.toLowerCase()) ?? false;
        const addressMatch = item.account?.apartment?.address?.toLowerCase().includes(search.toLowerCase()) ?? false;
        const labelMatch = (item.account?.customLabel || item.account?.accountLabel)?.toLowerCase().includes(search.toLowerCase()) ?? false;
        const commentMatch = item.parsedComment.toLowerCase().includes(search.toLowerCase());
        if (!periodIdMatch && !periodLabelMatch && !accountNumMatch && !addressMatch && !labelMatch && !commentMatch) {
          return false;
        }
      }

      return true;
    });
  }, [processedInvoices, search, selectedApartmentId, fromMonth, toMonth]);

  if (isLoading) return <div className={styles.emptyState}>Загрузка начислений...</div>;
  if (error) return <div className={styles.emptyState}>Ошибка загрузки начислений.</div>;

  const handleResetAllFilters = () => {
    setSelectedApartmentId('all');
    setFromMonth('');
    setToMonth('');
    setSearch('');
    if (accountIdParam) {
      router.push('/invoices');
    }
  };

  const handleOpenAddModal = () => {
    setAddAccountId(accounts && accounts.length > 0 ? String(accounts[0].id) : '');
    setIsAddModalOpen(true);
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
      {/* Top Header with Search and Create button */}
      <div className={styles.filterCard} style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', flex: 1 }}>
          {/* Search input */}
          <div className={styles.searchWrapper} style={{ minWidth: '220px', margin: 0 }}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Поиск по услуге, ЛС, описанию..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Apartment Select Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>Квартира:</label>
            <select
              value={selectedApartmentId}
              onChange={(e) => setSelectedApartmentId(e.target.value)}
              className={styles.searchInput}
              style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: '#fff', fontSize: '0.875rem', maxWidth: '240px' }}
            >
              <option value="all">Все квартиры</option>
              {apartments?.map(apt => (
                <option key={apt.id} value={apt.id}>
                  {apt.address || `Квартира #${apt.id}`}
                </option>
              ))}
            </select>
          </div>

          {/* Unified Date Range Picker */}
          <DateRangePicker
            fromMonth={fromMonth}
            toMonth={toMonth}
            onChange={(from, to) => { setFromMonth(from); setToMonth(to); }}
            onReset={() => { setFromMonth(''); setToMonth(''); }}
          />

          {/* Reset Filters button */}
          {(selectedApartmentId !== 'all' || fromMonth || toMonth || search || accountIdParam) && (
            <button
              onClick={handleResetAllFilters}
              style={{
                backgroundColor: '#f1f5f9',
                border: '1px solid #cbd5e1',
                color: '#475569',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '0.875rem',
                cursor: 'pointer',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <CloseIcon style={{ fontSize: '1rem' }} />
              Сбросить фильтры
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap' }}>
            Найдено: <strong>{filteredInvoices.length}</strong>
          </div>

          <button
            className={styles.downloadLink}
            style={{ padding: '9px 16px', display: 'flex', alignItems: 'center', gap: '6px', border: 'none', cursor: 'pointer', backgroundColor: '#4f46e5', color: '#fff', fontWeight: 600 }}
            onClick={handleOpenAddModal}
          >
            <AddIcon style={{ fontSize: '1.2rem' }} />
            Добавить счет вручную
          </button>
        </div>
      </div>

      {/* Table */}
      <TableContainer component={Paper} className={styles.tableCard}>
        <Table aria-label="invoices table">
          <TableHead>
            <TableRow>
              <TableCell style={{ fontWeight: 'bold' }}>ID</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Адрес квартиры</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Лицевой счет и Название</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Период</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Сумма</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Описание / Комментарий</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Статус</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Дата создания</TableCell>
              <TableCell style={{ fontWeight: 'bold' }}>Действия</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredInvoices.length > 0 ? (
              filteredInvoices.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.id}</TableCell>
                  <TableCell style={{ fontWeight: 500, color: '#1e293b', maxWidth: '200px' }}>
                    {row.account?.apartment?.address || 'Не указана'}
                  </TableCell>
                  <TableCell>
                    <div style={{ fontWeight: 600, color: '#0f172a' }}>
                      {row.account?.accountNumber || row.accountExternalId}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      {row.account?.customLabel || row.account?.accountLabel || '—'}
                    </div>
                  </TableCell>
                  <TableCell style={{ fontWeight: 600 }}>{row.periodLabel}</TableCell>
                  <TableCell style={{ fontWeight: 600 }}>
                    {row.amount !== null ? `${Number(row.amount).toFixed(2)} руб.` : '—'}
                  </TableCell>
                  <TableCell style={{ color: '#334155', maxWidth: '220px', wordBreak: 'break-word' }}>
                    {row.parsedComment ? (
                      <span style={{ backgroundColor: '#f1f5f9', padding: '4px 8px', borderRadius: '4px', fontSize: '0.85rem', color: '#1e293b', display: 'inline-block' }}>
                        {row.parsedComment}
                      </span>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.uploadedToS3 ? (
                      <span className={styles.statusConfirmed}>Загружен в S3</span>
                    ) : row.invoiceUrl || row.available ? (
                      <span className={styles.statusConfirmed}>Доступен</span>
                    ) : (
                      <span className={styles.statusPending}>Локально / Ожидает</span>
                    )}
                  </TableCell>
                  <TableCell style={{ color: '#64748b' }}>{formatDate(row.firstSeenAt)}</TableCell>
                  <TableCell>
                    <div className={styles.actionsCell}>
                      {row.uploadedToS3 || row.invoiceUrl || row.available ? (
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
                <TableCell colSpan={9} align="center">
                  <div className={styles.emptyState}>Начисления не найдены</div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Optimized Isolated Manual Invoice Creation Modal Component */}
      <AddInvoiceModal
        open={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={() => mutate()}
        accounts={accounts}
        initialAccountId={addAccountId}
      />

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
            Вы действительно хотите удалить этот инвойс? Данное действие необратимо.
          </DialogContentText>
        </DialogContent>
        <DialogActions style={{ padding: '16px 24px' }}>
          <Button onClick={() => setDeleteId(null)} variant="outlined" style={{ color: '#475569', borderColor: '#cbd5e1', textTransform: 'none' }}>
            Отмена
          </Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained" style={{ textTransform: 'none', backgroundColor: '#ef4444' }} autoFocus>
            Удалить инвойс
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
