export type RunStatus = 'success' | 'warning' | 'needs_login' | 'error';

export interface ApartmentSnapshot {
  externalId: string;
  address?: string;
  organization?: string;
  rawJson?: string;
}

export interface AccountSnapshot {
  externalId: string;
  apartmentExternalId: string;
  accountNumber?: string;
  accountLabel?: string;
  rawJson?: string;
}

export interface AccrualSnapshot {
  accountExternalId: string;
  periodLabel: string;
  periodId: string;
  amountText?: string;
  statusText?: string;
  sourceUrl?: string;
  rawJson?: string;
}

export interface InvoiceSnapshot {
  accountExternalId: string;
  periodLabel: string;
  periodId: string;
  invoiceUrl?: string;
  utilitiesUrl?: string;
  available: boolean;
  uploadedToS3: boolean;
  localFilePath?: string;
  rawJson?: string;
}

export interface ScanResult {
  apartments: ApartmentSnapshot[];
  accounts: AccountSnapshot[];
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
