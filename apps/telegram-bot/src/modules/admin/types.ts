export interface User {
  id: number;
  name?: string;
  role: string;
  telegramId?: string;
  createdAt: string;
  tenantProfile?: Tenant;
}

export interface Tenant {
  id: number;
  userId: number;
  apartmentId?: number;
  rentPaymentDay?: number;
  rentAmount?: number;
  status: string;
  createdAt: string;
  user?: User;
  apartment?: Apartment;
}

export interface Apartment {
  id: number;
  externalId: string;
  address?: string;
  organization?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  accounts?: Account[];
  tenants?: Tenant[];
}

export interface Account {
  id: number;
  externalId: string;
  apartmentId: number;
  accountNumber?: string;
  accountLabel?: string;
  customLabel?: string;
  balance?: number;
  firstSeenAt: string;
  lastSeenAt: string;
  accruals?: Accrual[];
  invoices?: Invoice[];
}

export interface Accrual {
  id: number;
  accountId: number;
  accountExternalId: string;
  periodId: string;
  periodLabel: string;
  amountText?: string;
  statusText?: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface Invoice {
  id: number;
  accountId: number;
  accountExternalId: string;
  periodId: string;
  periodLabel: string;
  amount?: number;
  invoiceUrl?: string;
  available: boolean;
  uploadedToS3: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface Payment {
  id: number;
  userId: number;
  userName?: string;
  amount: number;
  receiptPhotoId?: string;
  status: string;
  createdAt: string;
  confirmedAt?: string;
  confirmedBy?: string;
  comment?: string;
}
