'use client';
import * as React from 'react';
import { useState } from 'react';
import Button from '@mui/material/Button';
import Popover from '@mui/material/Popover';
import Paper from '@mui/material/Paper';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';

interface DateRangePickerProps {
  fromMonth: string; // 'YYYY-MM'
  toMonth: string;   // 'YYYY-MM'
  onChange: (from: string, to: string) => void;
  onReset: () => void;
}

export default function DateRangePicker({ fromMonth, toMonth, onChange, onReset }: DateRangePickerProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const [tempFrom, setTempFrom] = useState<string>(fromMonth);
  const [tempTo, setTempTo] = useState<string>(toMonth);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setTempFrom(fromMonth);
    setTempTo(toMonth);
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const open = Boolean(anchorEl);
  const id = open ? 'date-range-popover' : undefined;

  const handleApply = () => {
    onChange(tempFrom, tempTo);
    handleClose();
  };

  const handleResetLocal = () => {
    setTempFrom('');
    setTempTo('');
    onReset();
    handleClose();
  };

  // Quick Preset Helper
  const setPreset = (monthsBack: number | 'year' | 'all') => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
    const to = `${currentYear}-${currentMonth}`;

    if (monthsBack === 'all') {
      setTempFrom('');
      setTempTo('');
      onChange('', '');
      handleClose();
      return;
    }

    if (monthsBack === 'year') {
      const from = `${currentYear}-01`;
      setTempFrom(from);
      setTempTo(to);
      onChange(from, to);
      handleClose();
      return;
    }

    const pastDate = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1);
    const pastYear = pastDate.getFullYear();
    const pastMonth = String(pastDate.getMonth() + 1).padStart(2, '0');
    const from = `${pastYear}-${pastMonth}`;

    setTempFrom(from);
    setTempTo(to);
    onChange(from, to);
    handleClose();
  };

  const formatMonthLabel = (ym: string) => {
    if (!ym) return '';
    try {
      const [year, month] = ym.split('-');
      const date = new Date(Number(year), Number(month) - 1, 1);
      return date.toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' });
    } catch {
      return ym;
    }
  };

  const getButtonText = () => {
    if (fromMonth && toMonth) {
      if (fromMonth === toMonth) return formatMonthLabel(fromMonth);
      return `${formatMonthLabel(fromMonth)} — ${formatMonthLabel(toMonth)}`;
    }
    if (fromMonth) return `С ${formatMonthLabel(fromMonth)}`;
    if (toMonth) return `По ${formatMonthLabel(toMonth)}`;
    return 'Выберите период';
  };

  const hasFilter = Boolean(fromMonth || toMonth);

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <Button
        aria-describedby={id}
        variant="outlined"
        onClick={handleClick}
        startIcon={<CalendarTodayIcon style={{ fontSize: '1rem', color: hasFilter ? '#4f46e5' : '#64748b' }} />}
        style={{
          backgroundColor: hasFilter ? '#e0e7ff' : '#fff',
          borderColor: hasFilter ? '#818cf8' : '#cbd5e1',
          color: hasFilter ? '#3730a3' : '#334155',
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: '8px',
          padding: '8px 14px',
          fontSize: '0.875rem'
        }}
      >
        {getButtonText()}
      </Button>

      {hasFilter && (
        <button
          onClick={handleResetLocal}
          title="Сбросить период"
          style={{
            border: 'none',
            backgroundColor: '#f1f5f9',
            color: '#64748b',
            borderRadius: '50%',
            width: '28px',
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer'
          }}
        >
          <CloseIcon style={{ fontSize: '0.9rem' }} />
        </button>
      )}

      <Popover
        id={id}
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'left',
        }}
        PaperProps={{
          style: {
            padding: '20px',
            borderRadius: '12px',
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
            minWidth: '320px'
          }
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#0f172a' }}>
            Выбор периода
          </div>

          {/* Quick presets */}
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '8px' }}>
              Быстрый выбор
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              <button
                onClick={() => setPreset(1)}
                style={{ border: '1px solid #e2e8f0', backgroundColor: '#f8fafc', padding: '4px 10px', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer' }}
              >
                Текущий месяц
              </button>
              <button
                onClick={() => setPreset(3)}
                style={{ border: '1px solid #e2e8f0', backgroundColor: '#f8fafc', padding: '4px 10px', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer' }}
              >
                3 месяца
              </button>
              <button
                onClick={() => setPreset(6)}
                style={{ border: '1px solid #e2e8f0', backgroundColor: '#f8fafc', padding: '4px 10px', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer' }}
              >
                6 месяцев
              </button>
              <button
                onClick={() => setPreset('year')}
                style={{ border: '1px solid #e2e8f0', backgroundColor: '#f8fafc', padding: '4px 10px', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer' }}
              >
                С начала года
              </button>
              <button
                onClick={() => setPreset('all')}
                style={{ border: '1px solid #e2e8f0', backgroundColor: '#f8fafc', padding: '4px 10px', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer' }}
              >
                За всё время
              </button>
            </div>
          </div>

          <hr style={{ border: '0', borderTop: '1px solid #f1f5f9', margin: 0 }} />

          {/* Custom Date Range Picker inputs in a single row */}
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', marginBottom: '8px' }}>
              Произвольный период
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="month"
                value={tempFrom}
                onChange={(e) => setTempFrom(e.target.value)}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.85rem'
                }}
              />
              <span style={{ color: '#94a3b8', fontWeight: 600 }}>—</span>
              <input
                type="month"
                value={tempTo}
                onChange={(e) => setTempTo(e.target.value)}
                style={{
                  flex: 1,
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.85rem'
                }}
              />
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
            <Button
              onClick={handleResetLocal}
              size="small"
              style={{ color: '#64748b', textTransform: 'none' }}
            >
              Сбросить
            </Button>
            <Button
              onClick={handleApply}
              variant="contained"
              size="small"
              startIcon={<CheckIcon />}
              style={{ backgroundColor: '#4f46e5', textTransform: 'none', fontWeight: 600 }}
            >
              Применить
            </Button>
          </div>
        </div>
      </Popover>
    </div>
  );
}
