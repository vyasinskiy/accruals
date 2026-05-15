import { Injectable, Logger, Inject, NotFoundException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { PrismaService } from '../../common/prisma/prisma.service';
import { S3StorageService } from '../s3/s3-storage.service';

@Injectable()
export class AccountantService {
  private readonly logger = new Logger(AccountantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Storage: S3StorageService,
    @Inject('NOTIFICATIONS_SERVICE') private readonly notificationsClient: ClientProxy
  ) {}

  private serialize(data: any): any {
    if (!data) return data;
    return JSON.parse(JSON.stringify(data, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ));
  }

  async upsertApartment(data: any) {
    this.logger.debug(`Upserting apartment: ${data.externalId}`);
    const existing = await this.prisma.apartment.findUnique({
      where: { externalId: data.externalId },
    });

    const result = existing
      ? await this.prisma.apartment.update({
          where: { externalId: data.externalId },
          data: {
            address: data.address,
            organization: data.organization,
            rawJson: data.rawJson,
            lastSeenAt: new Date(),
          },
        })
      : await this.prisma.apartment.create({
          data: {
            ...data,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
          },
        });

    this.logger.log(`Apartment ${data.externalId} ${existing ? 'updated' : 'created'}`);
    return this.serialize(result);
  }

  async upsertAccount(data: any) {
    this.logger.debug(`Upserting account: ${data.externalId} for apartment ${data.apartmentExternalId}`);
    const apartment = await this.prisma.apartment.findUnique({
      where: { externalId: data.apartmentExternalId },
    });

    if (!apartment) {
      this.logger.error(`FAILED to upsert account ${data.externalId}: Apartment ${data.apartmentExternalId} NOT FOUND in DB`);
      return null;
    }

    const existing = await this.prisma.account.findUnique({
      where: { externalId: data.externalId },
    });

    const result = existing
      ? await this.prisma.account.update({
          where: { externalId: data.externalId },
          data: {
            accountNumber: data.accountNumber,
            accountLabel: data.accountLabel,
            rawJson: data.rawJson,
            lastSeenAt: new Date(),
          },
        })
      : await this.prisma.account.create({
          data: {
            externalId: data.externalId,
            apartmentId: apartment.id,
            accountNumber: data.accountNumber,
            accountLabel: data.accountLabel,
            rawJson: data.rawJson,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
          },
        });

    this.logger.log(`Account ${data.externalId} ${existing ? 'updated' : 'created'} (linked to apartment.id=${apartment.id})`);
    return this.serialize(result);
  }

  async upsertAccrual(data: any) {
    this.logger.debug(`Upserting accrual: account=${data.accountExternalId}, period=${data.periodId}`);
    const account = await this.prisma.account.findUnique({
      where: { externalId: data.accountExternalId },
    });

    if (!account) {
      this.logger.error(`FAILED to upsert accrual: Account with externalId ${data.accountExternalId} not found in DB`);
      return null;
    }

    const existing = await this.prisma.accrual.findUnique({
      where: {
        accountExternalId_periodId: {
          accountExternalId: data.accountExternalId,
          periodId: data.periodId,
        },
      },
    });

    const result = await this.prisma.accrual.upsert({
      where: {
        accountExternalId_periodId: {
          accountExternalId: data.accountExternalId,
          periodId: data.periodId,
        },
      },
      create: {
        accountExternalId: data.accountExternalId,
        periodId: data.periodId,
        periodLabel: data.periodLabel,
        amountText: data.amountText,
        statusText: data.statusText,
        sourceUrl: data.sourceUrl,
        rawJson: data.rawJson,
        accountId: account.id,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
      update: {
        amountText: data.amountText,
        statusText: data.statusText,
        sourceUrl: data.sourceUrl,
        rawJson: data.rawJson,
        lastSeenAt: new Date(),
      },
    });

    if (!existing) {
      this.notificationsClient.emit('accrual_upserted', {
        periodLabel: data.periodLabel,
        amountText: data.amountText,
        statusText: data.statusText,
        apartmentId: account.apartmentId
      });
    }

    return { result: this.serialize(result), isNew: !existing };
  }

  async upsertInvoice(data: any) {
    this.logger.debug(`Upserting invoice: account=${data.accountExternalId}, period=${data.periodId}`);
    const account = await this.prisma.account.findUnique({
      where: { externalId: data.accountExternalId },
    });

    if (!account) {
      this.logger.error(`FAILED to upsert invoice: Account with externalId ${data.accountExternalId} not found in DB`);
      return null;
    }

    const existing = await this.prisma.invoice.findUnique({
      where: {
        accountExternalId_periodId: {
          accountExternalId: data.accountExternalId,
          periodId: data.periodId,
        },
      },
    });

    // We only update 'uploadedToS3' if it's true in the incoming data. 
    // We don't want to revert it to false if it's already true in DB.
    const shouldUpdateUploaded = data.uploadedToS3 === true || (existing ? existing.uploadedToS3 : false);

    const result = await this.prisma.invoice.upsert({
      where: {
        accountExternalId_periodId: {
          accountExternalId: data.accountExternalId,
          periodId: data.periodId,
        },
      },
      create: {
        accountExternalId: data.accountExternalId,
        periodId: data.periodId,
        periodLabel: data.periodLabel,
        invoiceUrl: data.invoiceUrl,
        utilitiesUrl: data.utilitiesUrl,
        localFilePath: data.localFilePath,
        available: data.available,
        uploadedToS3: data.uploadedToS3 || false,
        rawJson: data.rawJson,
        accountId: account.id,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
      update: {
        invoiceUrl: data.invoiceUrl,
        utilitiesUrl: data.utilitiesUrl,
        localFilePath: data.localFilePath,
        available: data.available,
        uploadedToS3: shouldUpdateUploaded,
        rawJson: data.rawJson,
        lastSeenAt: new Date(),
      },
    });

    if (!existing) {
      this.notificationsClient.emit('invoice_available', {
        periodLabel: data.periodLabel,
        apartmentId: account.apartmentId
      });
    }

    return { result: this.serialize(result), isNew: !existing };
  }

  async createPayment(data: { userId: number; userName: string; amount: number; receiptPhotoId: string }) {
    const result = await this.prisma.payment.create({
      data: {
        userId: data.userId,
        userName: data.userName,
        amount: data.amount,
        receiptPhotoId: data.receiptPhotoId,
        status: 'unconfirmed',
      },
    });
    return this.serialize(result);
  }

  async confirmPayment(paymentId: number, confirmedBy: number) {
    const result = await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'confirmed',
        confirmedAt: new Date(),
        confirmedBy: BigInt(confirmedBy),
      },
    });
    return this.serialize(result);
  }

  async rejectPayment(paymentId: number, confirmedBy: number, comment?: string) {
    const result = await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'rejected',
        confirmedAt: new Date(),
        confirmedBy: BigInt(confirmedBy),
        comment,
      },
    });
    return this.serialize(result);
  }

  async findApartments(filters: { address?: string; organization?: string; externalId?: string }) {
    const where: any = {
      ...(filters.externalId ? { externalId: { contains: filters.externalId, mode: 'insensitive' } } : {}),
      ...(filters.address ? { address: { contains: filters.address, mode: 'insensitive' } } : {}),
      ...(filters.organization ? { organization: { contains: filters.organization, mode: 'insensitive' } } : {}),
    };
    const results = await this.prisma.apartment.findMany({ where, orderBy: [{ address: 'asc' }] });
    return this.serialize(results);
  }

  async findAccounts(filters: { apartmentId?: number; apartmentExternalId?: string; accountNumber?: string; externalId?: string }) {
    const where: any = {
      ...(filters.apartmentId ? { apartmentId: Number(filters.apartmentId) } : {}),
      ...(filters.apartmentExternalId ? { apartment: { externalId: filters.apartmentExternalId } } : {}),
      ...(filters.externalId ? { externalId: { contains: filters.externalId, mode: 'insensitive' } } : {}),
      ...(filters.accountNumber ? { accountNumber: { contains: filters.accountNumber, mode: 'insensitive' } } : {}),
    };
    const results = await this.prisma.account.findMany({ where, include: { apartment: true }, orderBy: [{ externalId: 'asc' }] });
    return this.serialize(results);
  }

  async findAccruals(filters: { accountId?: number; accountExternalId?: string; periodLabel?: string }) {
    const where: any = {
      ...(filters.accountId ? { accountId: Number(filters.accountId) } : {}),
      ...(filters.accountExternalId ? { accountExternalId: filters.accountExternalId } : {}),
      ...(filters.periodLabel ? { periodLabel: { contains: filters.periodLabel, mode: 'insensitive' } } : {})
    };
    const results = await this.prisma.accrual.findMany({ where, include: { account: { include: { apartment: true } } }, orderBy: [{ periodLabel: 'desc' }] });
    return this.serialize(results);
  }

  async findInvoices(filters: { 
    accountId?: number; 
    accountExternalId?: string | string[]; 
    periodLabel?: string; 
    periodId?: string; 
    available?: boolean | string;
    uploadedToS3?: boolean | string;
  }) {
    const where: any = {
      ...(filters.accountId ? { accountId: Number(filters.accountId) } : {}),
      ...(filters.accountExternalId ? { 
        accountExternalId: Array.isArray(filters.accountExternalId) 
          ? { in: filters.accountExternalId } 
          : filters.accountExternalId 
      } : {}),
      ...(filters.periodLabel ? { periodLabel: { contains: filters.periodLabel, mode: 'insensitive' } } : {}),
      ...(filters.periodId ? { periodId: filters.periodId } : {}),
    };

    if (filters.available !== undefined) {
      where.available = filters.available === 'true' || filters.available === true;
    }
    if (filters.uploadedToS3 !== undefined) {
      where.uploadedToS3 = filters.uploadedToS3 === 'true' || filters.uploadedToS3 === true;
    }

    const results = await this.prisma.invoice.findMany({ 
      where, 
      include: { account: { include: { apartment: true } } }, 
      orderBy: [{ periodLabel: 'desc' }] 
    });
    return this.serialize(results);
  }

  async findApartmentById(id: number) {
    const apartment = await this.prisma.apartment.findUnique({
      where: { id },
      include: { accounts: true },
    });
    return this.serialize(apartment);
  }

  async findTenantByApartment(apartmentId: number) {
    const tenant = await this.prisma.user.findFirst({
      where: { tenantProfile: { apartmentId, status: 'active' } },
      include: { identities: true }
    });
    return this.serialize(tenant);
  }

  async findInvoiceByPeriod(accountExternalId: string, period: string) {
    const normalizedPeriod = normalizePeriod(period);
    const account = await this.prisma.account.findUnique({
      where: { externalId: accountExternalId },
      include: { apartment: true }
    });
    
    if (!account) {
      throw new NotFoundException(`Account ${accountExternalId} not found`);
    }

    const invoices = await this.prisma.invoice.findMany({ where: { accountExternalId } });
    const invoice = invoices.find((inv: any) => 
      inv.periodId === normalizedPeriod || inv.periodId === period || inv.periodLabel === normalizedPeriod || inv.periodLabel === period
    );

    if (!invoice) {
      throw new NotFoundException(`Invoice for account ${accountExternalId} and period ${period} not found`);
    }

    const parsedRaw = safeJsonParse<Record<string, unknown>>(invoice.rawJson);
    const storageKey = parsedRaw?.s3Key as string || (isS3Key(invoice.localFilePath) ? invoice.localFilePath : null);
    const downloadUrl = storageKey && this.s3Storage.isEnabled() ? this.s3Storage.getSignedDownloadUrl(storageKey) : null;

    return this.serialize({ account, invoice, storageKey, downloadUrl });
  }
}

function normalizePeriod(period: string): string {
  const trimmed = period.trim();
  if (/^\d{6}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}$/.test(trimmed)) return trimmed.replace('-', '');
  return trimmed;
}

function isS3Key(value?: string | null): value is string {
  return Boolean(value && !value.startsWith('/') && !value.startsWith('.') && value.toLowerCase().endsWith('.pdf'));
}

function safeJsonParse<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}
