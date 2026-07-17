'use client';
import * as React from 'react';
import { useState } from 'react';
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
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';

interface ScraperRun {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  trigger: string;
  status: string; // started, completed, failed
  message: string | null;
  apartmentsScanned: number;
  accrualsObserved: number;
  invoicesObserved: number;
  newApartments: number;
  newAccruals: number;
  newInvoices: number;
  needsLogin: boolean;
}

const fetcher = (url: string) => axios.get(url).then(res => res.data);

export default function ScanningPage() {
  const [triggering, setTriggering] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Poll scraper runs history every 4 seconds
  const { data: runs, error, mutate, isLoading } = useSWR<ScraperRun[]>(
    '/api/watcher/runs', 
    fetcher, 
    { refreshInterval: 4000 }
  );

  const handleStartScan = async () => {
    setTriggering(true);
    setErrorMsg(null);
    try {
      await axios.post('/api/watcher/scan', { force: true });
      // Instantly mutate to get updated status
      mutate();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ошибка связи с парсером';
      setErrorMsg('Не удалось запустить сканирование. Убедитесь, что контейнер watcher работает на порту 4500.');
    } finally {
      setTriggering(false);
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
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return dateStr;
    }
  };

  const renderRunStatus = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className={styles.statusConfirmed}>
            <CheckCircleIcon style={{ fontSize: '0.9rem', marginRight: '4px', verticalAlign: 'middle' }} />
            Завершено
          </span>
        );
      case 'failed':
        return (
          <span className={styles.statusRejected}>
            <ErrorIcon style={{ fontSize: '0.9rem', marginRight: '4px', verticalAlign: 'middle' }} />
            Ошибка
          </span>
        );
      case 'started':
      case 'running':
        return (
          <span className={styles.statusPending} style={{ animation: 'pulse 1.5s infinite' }}>
            <HourglassEmptyIcon style={{ fontSize: '0.9rem', marginRight: '4px', verticalAlign: 'middle' }} />
            Выполняется...
          </span>
        );
      default:
        return <span className={styles.statusPending}>{status}</span>;
    }
  };

  const isScraperBusy = runs?.some(run => run.status === 'started' || run.status === 'running') ?? false;

  return (
    <div className={styles.container}>
      {/* Control panel card */}
      <div className={styles.filterCard} style={{ display: 'block', padding: '24px' }}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '1.15rem', color: '#0f172a' }}>
          Управление фоновым парсером
        </h3>
        <p style={{ margin: '0 0 20px 0', fontSize: '0.875rem', color: '#64748b', lineHeight: '1.5' }}>
          Парсер автоматически сканирует личные кабинеты внешних поставщиков услуг (ЖКХ, Энергосбыт), чтобы скачать свежие начисления, лицевые счета и PDF-файлы инвойсов. Вы можете принудительно запустить сессию сканирования кнопкой ниже.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <button
            className={styles.downloadLink}
            style={{ 
              padding: '12px 24px', 
              fontSize: '0.875rem', 
              borderRadius: '8px', 
              cursor: isScraperBusy || triggering ? 'not-allowed' : 'pointer',
              backgroundColor: isScraperBusy || triggering ? '#94a3b8' : '#4f46e5',
              border: 'none',
              pointerEvents: isScraperBusy || triggering ? 'none' : 'auto'
            }}
            onClick={handleStartScan}
            disabled={isScraperBusy || triggering}
          >
            <PlayArrowIcon style={{ fontSize: '1.2rem', marginRight: '4px' }} />
            {isScraperBusy ? 'Выполняется сканирование...' : triggering ? 'Запуск...' : 'Запустить сканирование'}
          </button>

          {isScraperBusy && (
            <span style={{ fontSize: '0.875rem', color: '#4f46e5', fontWeight: 600 }}>
              Парсер занят, история логов обновляется автоматически...
            </span>
          )}
        </div>

        {errorMsg && (
          <div style={{ color: '#ef4444', fontSize: '0.875rem', fontWeight: 500, marginTop: '16px' }}>
            {errorMsg}
          </div>
        )}
      </div>

      {/* History table */}
      <div>
        <h4 style={{ margin: '0 0 16px 0', fontSize: '1rem', color: '#0f172a', fontWeight: 700 }}>
          История запусков парсера
        </h4>
        <TableContainer component={Paper} className={styles.tableCard}>
          <Table aria-label="scraper runs table">
            <TableHead>
              <TableRow>
                <TableCell style={{ fontWeight: 'bold' }}>ID запуск</TableCell>
                <TableCell style={{ fontWeight: 'bold' }}>Инициатор</TableCell>
                <TableCell style={{ fontWeight: 'bold' }}>Статус</TableCell>
                <TableCell style={{ fontWeight: 'bold' }}>Начало</TableCell>
                <TableCell style={{ fontWeight: 'bold' }}>Конец</TableCell>
                <TableCell style={{ fontWeight: 'bold' }}>Сканировано квартир</TableCell>
                <TableCell style={{ fontWeight: 'bold' }}>Новых счетов / PDF</TableCell>
                <TableCell style={{ fontWeight: 'bold' }}>Сообщение</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {runs && runs.length > 0 ? (
                runs.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.id}</TableCell>
                    <TableCell style={{ fontWeight: 500 }}>
                      {row.trigger === 'manual' ? 'Вручную (Админ)' : row.trigger === 'cron' ? 'Планировщик (Cron)' : row.trigger}
                    </TableCell>
                    <TableCell>{renderRunStatus(row.status)}</TableCell>
                    <TableCell style={{ color: '#64748b' }}>{formatDate(row.startedAt)}</TableCell>
                    <TableCell style={{ color: '#64748b' }}>{formatDate(row.finishedAt)}</TableCell>
                    <TableCell style={{ fontWeight: 600, textAlign: 'center' }}>
                      {row.apartmentsScanned}
                    </TableCell>
                    <TableCell style={{ fontWeight: 600, color: '#4f46e5', textAlign: 'center' }}>
                      {row.newAccruals} / {row.newInvoices}
                    </TableCell>
                    <TableCell style={{ color: '#475569', fontSize: '0.8rem', maxWidth: '250px', wordBreak: 'break-word' }}>
                      {row.message || '—'}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={8} align="center">
                    <div className={styles.emptyState}>
                      {isLoading ? 'Загрузка истории запусков...' : 'Запуски парсера не обнаружены'}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </div>
    </div>
  );
}
