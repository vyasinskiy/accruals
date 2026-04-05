export type RunStatus = 'success' | 'warning' | 'needs_login' | 'error';

export interface AccountSnapshot {
  externalId: string;
  name: string;
  url?: string;
}

export interface ReceiptSnapshot {
  accountExternalId: string;
  monthLabel: string;
  amountText: string;
  statusText?: string;
  receiptAvailable: boolean;
  receiptUrl?: string;
  receiptDownloaded: boolean;
  fingerprint: string;
  observedAt: string;
  rawJson?: string;
}

export interface ScanSummary {
  startedAt: string;
  finishedAt: string;
  status: RunStatus;
  message: string;
  accountsScanned: number;
  receiptsObserved: number;
  newReceipts: ReceiptSnapshot[];
  knownReceipts: number;
  needsLogin: boolean;
}
