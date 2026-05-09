export type RunStatus = 'success' | 'warning' | 'needs_login' | 'error';

export interface ApartmentSnapshot {
  externalId: string;
  parentApartmentId?: string;
  address?: string;
  organization?: string;
  accountNumber?: string;
  accountLabel?: string;
  rawJson?: string;
}

export interface AccrualSnapshot {
  apartmentExternalId: string;
  parentApartmentId?: string;
  periodLabel: string;
  periodId?: string;
  amountText?: string;
  statusText?: string;
  sourceUrl?: string;
  fingerprint: string;
  rawJson?: string;
}

export interface InvoiceSnapshot {
  apartmentExternalId: string;
  parentApartmentId?: string;
  periodLabel: string;
  periodId?: string;
  invoiceUrl?: string;
  utilitiesUrl?: string;
  available: boolean;
  downloaded: boolean;
  fingerprint: string;
  localFilePath?: string;
  rawJson?: string;
}

export interface ScanResult {
  apartments: ApartmentSnapshot[];
  accruals: AccrualSnapshot[];
  invoices: InvoiceSnapshot[];
  needsLogin: boolean;
  degraded: boolean;
  message: string;
}

export interface ScanSummary {
  startedAt: string;
  finishedAt: string;
  trigger: 'manual' | 'cron';
  status: RunStatus;
  message: string;
  apartmentsScanned: number;
  accrualsObserved: number;
  invoicesObserved: number;
  newApartments: number;
  newAccruals: number;
  newInvoices: number;
  needsLogin: boolean;
}
