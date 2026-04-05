export type RunStatus = 'success' | 'warning' | 'needs_login' | 'error';

export interface ApartmentSnapshot {
  externalId: string;
  address?: string;
  organization?: string;
  accountNumber?: string;
  rawJson?: string;
}

export interface AccrualSnapshot {
  apartmentExternalId: string;
  periodLabel: string;
  amountText?: string;
  statusText?: string;
  sourceUrl?: string;
  fingerprint: string;
  rawJson?: string;
}

export interface InvoiceSnapshot {
  apartmentExternalId: string;
  periodLabel: string;
  invoiceUrl?: string;
  utilitiesUrl?: string;
  available: boolean;
  downloaded: boolean;
  fingerprint: string;
  rawJson?: string;
}

export interface ScanResult {
  apartments: ApartmentSnapshot[];
  accruals: AccrualSnapshot[];
  invoices: InvoiceSnapshot[];
  needsLogin: boolean;
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
