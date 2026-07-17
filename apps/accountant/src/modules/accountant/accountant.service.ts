import { Injectable, Logger, Inject, NotFoundException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma } from '../../generated/client';
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
            balance: data.balance,
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
            balance: data.balance,
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
      include: {
        apartment: {
          include: {
            tenants: {
              where: { status: 'active' },
              include: { user: true }
            }
          }
        }
      }
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
      const activeTenant = account.apartment?.tenants?.[0];
      const tenant = activeTenant ? {
        id: activeTenant.id,
        status: activeTenant.status
      } : undefined;

      this.notificationsClient.emit('accrual_upserted', {
        periodLabel: data.periodLabel,
        amountText: data.amountText,
        statusText: data.statusText,
        rawJson: result.rawJson,
        apartment: {
          id: account.apartmentId,
          address: account.apartment?.address || account.apartment?.externalId || 'неизвестен'
        },
        tenant
      });
    }

    return { result: this.serialize(result), isNew: !existing };
  }

  async upsertInvoice(data: any) {
    this.logger.debug(`Upserting invoice: account=${data.accountExternalId}, period=${data.periodId}`);
    const account = await this.prisma.account.findUnique({
      where: { externalId: data.accountExternalId },
      include: {
        apartment: {
          include: {
            tenants: {
              where: { status: 'active' },
              include: { user: true }
            }
          }
        }
      }
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
        amount: data.amount,
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
        amount: data.amount,
        invoiceUrl: data.invoiceUrl,
        utilitiesUrl: data.utilitiesUrl,
        localFilePath: data.localFilePath,
        available: data.available,
        uploadedToS3: shouldUpdateUploaded,
        rawJson: data.rawJson,
        lastSeenAt: new Date(),
      },
    });

    const wasReady = existing ? (existing.available && this.s3Storage.isUploaded(existing.uploadedToS3)) : false;
    const nowReady = result.available && this.s3Storage.isUploaded(result.uploadedToS3);

    if (!wasReady && nowReady) {
      const activeTenant = account.apartment?.tenants?.[0];
      const tenant = activeTenant ? {
        id: activeTenant.id,
        status: activeTenant.status
      } : undefined;

      this.notificationsClient.emit('invoice_available', {
        id: result.id,
        periodLabel: data.periodLabel,
        apartment: {
          id: account.apartmentId,
          address: account.apartment?.address || account.apartment?.externalId || 'неизвестен'
        },
        tenant
      });
    }

    // Trigger debt check
    await this.checkAccountDebt(account.id);

    return { result: this.serialize(result), isNew: !existing };
  }

  private async checkAccountDebt(accountId: number) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      include: { apartment: true }
    });

    if (!account || !account.balance) return;

    // We consider negative balance as debt (e.g. -6488.87 means 6488.87 is owed)
    const debt = Math.abs(Number(account.balance));

    // Find the latest invoice for this account to compare
    const latestInvoice = await this.prisma.invoice.findFirst({
      where: { accountId: account.id },
      orderBy: { periodId: 'desc' }
    });

    if (!latestInvoice || !latestInvoice.amount) return;

    const invoiceAmount = Math.abs(Number(latestInvoice.amount));
    const threshold = invoiceAmount * 1.1; // 10% tolerance

    if (debt > threshold) {
      this.logger.warn(`DEBT WARNING for account ${account.externalId}: debt=${debt}, last_invoice=${invoiceAmount}`);
      this.notificationsClient.emit('notify_debt_warning', {
        accountExternalId: account.externalId,
        accountLabel: account.accountLabel,
        apartmentAddress: account.apartment?.address,
        debt: debt.toFixed(2),
        lastInvoiceAmount: invoiceAmount.toFixed(2),
        periodLabel: latestInvoice.periodLabel
      });
    }
  }

  async createPayment(data: { tenantId: number; userName: string; amount: number; receiptPhotoId: string | null }) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: data.tenantId }
    });

    if (!tenant) {
      throw new Error(`Tenant with ID ${data.tenantId} not found in accounting system.`);
    }

    const result = await this.prisma.payment.create({
      data: {
        userId: tenant.userId,
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

  async updateTenantPaymentSettings(tenantId: number, rentPaymentDay?: number, rentAmount?: number) {
    const data: any = {};
    if (rentPaymentDay !== undefined) data.rentPaymentDay = rentPaymentDay;
    if (rentAmount !== undefined) data.rentAmount = rentAmount;

    const result = await this.prisma.tenant.update({
      where: { id: tenantId },
      data,
    });
    return this.serialize(result);
  }

  async updateAccountCustomLabel(accountId: number, customLabel: string | null) {
    const result = await this.prisma.account.update({
      where: { id: accountId },
      data: { customLabel },
    });
    return this.serialize(result);
  }

  async createActiveTenantManual(data: { name: string; apartmentId: number; rentPaymentDay: number; rentAmount: number }) {
    const user = await this.prisma.user.create({
      data: {
        name: data.name,
        role: 'tenant',
        tenantProfile: {
          create: {
            apartmentId: data.apartmentId,
            rentPaymentDay: data.rentPaymentDay,
            rentAmount: data.rentAmount,
            status: 'active'
          }
        }
      },
      include: { tenantProfile: true }
    });
    return this.serialize(user);
  }

  async findApartments(filters: { address?: string; organization?: string; externalId?: string }) {
    const where: any = {
      ...(filters.externalId ? { externalId: { contains: filters.externalId, mode: 'insensitive' } } : {}),
      ...(filters.address ? { address: { contains: filters.address, mode: 'insensitive' } } : {}),
      ...(filters.organization ? { organization: { contains: filters.organization, mode: 'insensitive' } } : {}),
    };
    const results = await this.prisma.apartment.findMany({ 
      where, 
      include: {
        tenants: {
          where: { status: 'active' },
          include: { user: true }
        },
        accounts: {
          include: {
            accruals: {
              orderBy: { periodId: 'desc' },
              take: 1
            }
          }
        }
      },
      orderBy: [{ address: 'asc' }] 
    });
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

  async findAccruals(filters: { accountId?: number; accountExternalId?: string | string[]; periodLabel?: string }) {
    const where: any = {
      ...(filters.accountId ? { accountId: Number(filters.accountId) } : {}),
      ...(filters.accountExternalId ? { 
        accountExternalId: Array.isArray(filters.accountExternalId) 
          ? { in: filters.accountExternalId } 
          : filters.accountExternalId 
      } : {}),
      ...(filters.periodLabel ? { periodLabel: { contains: filters.periodLabel, mode: 'insensitive' } } : {})
    };
    const results = await this.prisma.accrual.findMany({ where, include: { account: { include: { apartment: true } } }, orderBy: [{ periodLabel: 'desc' }] });
    return this.serialize(results);
  }

  async findAccrualsPaginated(query: { skip?: number; take?: number }) {
    const skip = Number(query.skip) || 0;
    const take = Number(query.take) || 5;

    const total = await this.prisma.accrual.count();

    const accruals = await this.prisma.accrual.findMany({
      orderBy: [{ periodId: 'desc' }, { firstSeenAt: 'desc' }],
      skip,
      take,
      include: {
        account: {
          include: {
            apartment: true
          }
        }
      }
    });

    let items: any[] = [];
    if (accruals.length > 0) {
      const invoices = await this.prisma.invoice.findMany({
        where: {
          OR: accruals.map(a => ({
            accountExternalId: a.accountExternalId,
            periodId: a.periodId
          }))
        }
      });

      const invoiceMap = new Map<string, typeof invoices[0]>();
      for (const inv of invoices) {
        invoiceMap.set(`${inv.accountExternalId}_${inv.periodId}`, inv);
      }

      items = accruals.map(a => {
        const matchingInv = invoiceMap.get(`${a.accountExternalId}_${a.periodId}`);
        return {
          id: a.id,
          accountId: a.accountId,
          accountExternalId: a.accountExternalId,
          periodId: a.periodId,
          periodLabel: a.periodLabel,
          amountText: a.amountText,
          statusText: a.statusText,
          firstSeenAt: a.firstSeenAt,
          lastSeenAt: a.lastSeenAt,
          account: a.account,
          rawJson: a.rawJson,
          invoiceId: matchingInv?.id,
          invoiceAvailable: matchingInv ? (matchingInv.available && matchingInv.uploadedToS3) : false
        };
      });
    }

    return this.serialize({ items, total });
  }

  async findInvoices(filters: { 
    accountId?: number; 
    accountExternalId?: string | string[]; 
    periodLabel?: string; 
    periodId?: string; 
    available?: boolean | string;
    uploadedToS3?: boolean | string;
    take?: number | string;
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
      orderBy: [{ periodId: 'desc' }],
      ...(filters.take ? { take: Number(filters.take) } : {})
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
      where: { tenantProfile: { apartmentId, status: 'active' } }
    });
    return this.serialize(tenant);
  }

  async findAllUsers() {
    const users = await this.prisma.user.findMany({
      include: {
        tenantProfile: {
          include: { apartment: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    return this.serialize(users);
  }

  async findInvoiceById(id: number) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { account: { include: { apartment: true } } }
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }

    const parsedRaw = safeJsonParse<Record<string, unknown>>(invoice.rawJson);
    const storageKey = parsedRaw?.s3Key as string || (isS3Key(invoice.localFilePath) ? invoice.localFilePath : null);
    const downloadUrl = storageKey && this.s3Storage.isEnabled() ? this.s3Storage.getSignedDownloadUrl(storageKey) : null;

    return this.serialize({ invoice, storageKey, downloadUrl });
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

  async findPayments(filters: { userId?: number; status?: string; userName?: string } = {}) {
    const where: Prisma.PaymentWhereInput = {};
    if (filters.userId) {
      where.userId = Number(filters.userId);
    }
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.userName) {
      where.userName = { contains: filters.userName, mode: 'insensitive' };
    }
    const results = await this.prisma.payment.findMany({
      where,
      include: {
        user: true,
      },
      orderBy: [{ createdAt: 'desc' }],
    });
    return this.serialize(results);
  }

  async findMeterSubmissionEvents(filters: { accountId?: number; status?: string } = {}) {
    const where: Prisma.MeterSubmissionEventWhereInput = {};
    if (filters.accountId) {
      where.accountId = Number(filters.accountId);
    }
    if (filters.status) {
      where.status = filters.status;
    }
    const results = await this.prisma.meterSubmissionEvent.findMany({
      where,
      include: {
        account: {
          include: {
            apartment: true,
          },
        },
      },
      orderBy: [{ targetDate: 'desc' }],
    });
    return this.serialize(results);
  }

  async findSystemEvents(filters: { status?: string; type?: string } = {}) {
    const where: Prisma.EventWhereInput = {};
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.type) {
      where.type = filters.type;
    }
    const results = await this.prisma.event.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
    });
    return this.serialize(results);
  }

  async getStats() {
    const totalPayments = await this.prisma.payment.count();
    const pendingPayments = await this.prisma.payment.count({
      where: { status: 'unconfirmed' },
    });
    const upcomingEvents = await this.prisma.meterSubmissionEvent.count({
      where: { status: 'PENDING' },
    });
    return {
      totalPayments,
      pendingPayments,
      upcomingEvents,
    };
  }

  async deleteApartment(id: number) {
    return this.prisma.apartment.delete({ where: { id } });
  }

  async deleteAccount(id: number) {
    return this.prisma.account.delete({ where: { id } });
  }

  async deleteInvoice(id: number) {
    return this.prisma.invoice.delete({ where: { id } });
  }

  async deletePayment(id: number) {
    return this.prisma.payment.delete({ where: { id } });
  }

  async deleteMeterSubmissionEvent(id: number) {
    return this.prisma.meterSubmissionEvent.delete({ where: { id } });
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
