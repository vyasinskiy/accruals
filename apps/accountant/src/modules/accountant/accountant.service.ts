import { Injectable, Logger, Inject, NotFoundException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';
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
      include: { 
        accounts: true,
        tenants: {
          include: { user: true }
        }
      },
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
    
    let downloadUrl: string | null = null;
    if (storageKey && this.s3Storage.isEnabled()) {
      downloadUrl = this.s3Storage.getSignedDownloadUrl(storageKey);
    } else if (invoice.invoiceUrl) {
      downloadUrl = invoice.invoiceUrl;
    }

    return this.serialize({ invoice, storageKey, downloadUrl });
  }

  async createManualInvoice(data: { accountId: number; period: string; amount: number; comment: string }) {
    const account = await this.prisma.account.findUnique({
      where: { id: Number(data.accountId) },
      include: { apartment: true }
    });
    if (!account) {
      throw new NotFoundException(`Account ${data.accountId} not found`);
    }

    const periodClean = (data.period || '').replace('-', '').trim();
    const uniquePeriodId = `manual-${periodClean}-${Date.now()}`;

    const invoice = await this.prisma.invoice.create({
      data: {
        accountId: account.id,
        accountExternalId: account.externalId,
        periodId: uniquePeriodId,
        periodLabel: periodClean,
        amount: data.amount,
        available: true,
        uploadedToS3: false,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        rawJson: JSON.stringify({
          manual: true,
          comment: data.comment,
          amount: data.amount,
          periodId: periodClean,
          accountId: account.externalId
        })
      },
      include: { account: { include: { apartment: true } } }
    });

    return this.serialize(invoice);
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

  async findTenants() {
    const results = await this.prisma.tenant.findMany({
      include: {
        user: true,
        apartment: true,
      },
      orderBy: { id: 'desc' },
    });
    return this.serialize(results);
  }

  async createTenant(data: { name: string; apartmentId?: number; rentPaymentDay?: number; rentAmount?: number }) {
    const user = await this.prisma.user.create({
      data: {
        name: data.name,
        role: 'tenant',
      }
    });

    const tenant = await this.prisma.tenant.create({
      data: {
        userId: user.id,
        apartmentId: data.apartmentId || null,
        rentPaymentDay: data.rentPaymentDay || null,
        rentAmount: data.rentAmount || null,
        status: 'active',
      },
      include: { user: true, apartment: true }
    });

    return this.serialize(tenant);
  }

  async updateTenant(id: number, data: { name?: string; apartmentId?: number | null; rentPaymentDay?: number | null; rentAmount?: number | null; status?: string }) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: { user: true }
    });
    if (!tenant) throw new NotFoundException(`Tenant with ID ${id} not found`);

    if (data.name) {
      await this.prisma.user.update({
        where: { id: tenant.userId },
        data: { name: data.name }
      });
    }

    const updated = await this.prisma.tenant.update({
      where: { id },
      data: {
        apartmentId: data.apartmentId === undefined ? tenant.apartmentId : data.apartmentId,
        rentPaymentDay: data.rentPaymentDay === undefined ? tenant.rentPaymentDay : data.rentPaymentDay,
        rentAmount: data.rentAmount === undefined ? tenant.rentAmount : data.rentAmount,
        status: data.status === undefined ? tenant.status : data.status,
      },
      include: { user: true, apartment: true }
    });

    return this.serialize(updated);
  }

  async deleteTenant(id: number) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id }
    });
    if (!tenant) throw new NotFoundException(`Tenant with ID ${id} not found`);
    return this.prisma.user.delete({
      where: { id: tenant.userId }
    });
  }

  async findTenantById(id: number) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        user: true,
        apartment: {
          include: {
            accounts: true
          }
        }
      }
    });
    if (!tenant) throw new NotFoundException(`Tenant with ID ${id} not found`);
    return this.serialize(tenant);
  }

  // --- SCHEDULED EVENTS ENGINE ---

  @Cron(CronExpression.EVERY_MINUTE)
  async handleScheduledEventsCheck() {
    const now = new Date();
    try {
      const dueTriggers = await this.prisma.eventTrigger.findMany({
        where: {
          sentTelegramAt: null,
          triggerDate: { lte: now },
          scheduledEvent: {
            sendTelegram: true,
            active: true
          }
        },
        include: {
          scheduledEvent: true
        }
      });

      if (dueTriggers.length === 0) return;

      this.logger.log(`Found ${dueTriggers.length} scheduled event trigger(s) due for Telegram notification`);

      for (const trigger of dueTriggers) {
        const event = trigger.scheduledEvent;
        try {
          this.notificationsClient.emit('scheduled_event_triggered', {
            eventId: event.id,
            triggerId: trigger.id,
            title: event.title,
            description: event.description,
            targetType: event.targetType,
            frequency: event.frequency,
            dayOfMonth: event.dayOfMonth,
            timeOfDay: event.timeOfDay,
            telegramTemplate: event.telegramTemplate,
            createdAt: event.createdAt
          });

          await this.prisma.eventTrigger.update({
            where: { id: trigger.id },
            data: { sentTelegramAt: now }
          });

          this.logger.log(`Emitted scheduled_event_triggered for trigger #${trigger.id} (event #${event.id})`);
        } catch (err: unknown) {
          this.logger.error(`Failed to emit scheduled_event_triggered for trigger #${trigger.id}`, err);
        }
      }
    } catch (err: unknown) {
      this.logger.error('Error checking scheduled event triggers', err);
    }
  }

  async findScheduledEvents() {
    const events = await this.prisma.scheduledEvent.findMany({
      include: {
        account: { include: { apartment: true } },
        tenant: { include: { user: true, apartment: true } },
        apartment: true,
        triggers: {
          orderBy: { triggerDate: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    return this.serialize(events);
  }

  async findScheduledEventById(id: number) {
    const event = await this.prisma.scheduledEvent.findUnique({
      where: { id: Number(id) },
      include: {
        account: { include: { apartment: true } },
        tenant: { include: { user: true, apartment: true } },
        apartment: true,
        triggers: {
          orderBy: { triggerDate: 'desc' }
        }
      }
    });
    if (!event) {
      throw new NotFoundException(`Scheduled event #${id} not found`);
    }
    return this.serialize(event);
  }

  async createScheduledEvent(data: {
    title: string;
    description?: string;
    targetType: string;
    accountId?: number;
    tenantId?: number;
    apartmentId?: number;
    frequency?: string;
    dayOfMonth?: number;
    timeOfDay?: string;
    sendTelegram?: boolean;
    telegramTemplate?: string;
  }) {
    const day = Math.min(Math.max(Number(data.dayOfMonth) || 20, 1), 31);
    const freq = data.frequency || 'monthly';
    const stepMonths = freq === 'quarterly' ? 3 : 1;
    const timeOfDayStr = data.timeOfDay?.trim() || '10:00';

    const event = await this.prisma.scheduledEvent.create({
      data: {
        title: data.title.trim(),
        description: data.description?.trim() || null,
        targetType: data.targetType || 'general',
        accountId: data.accountId ? Number(data.accountId) : null,
        tenantId: data.tenantId ? Number(data.tenantId) : null,
        apartmentId: data.apartmentId ? Number(data.apartmentId) : null,
        frequency: freq,
        dayOfMonth: day,
        timeOfDay: timeOfDayStr,
        sendTelegram: data.sendTelegram ?? true,
        telegramTemplate: data.telegramTemplate?.trim() || null,
        active: true
      }
    });

    // Parse UTC hours and minutes
    const [rawH, rawM] = timeOfDayStr.split(':').map(Number);
    const hours = isNaN(rawH) ? 10 : rawH;
    const minutes = isNaN(rawM) ? 0 : rawM;

    // Generate initial triggers starting from current month (i = 0) to next 5 periods
    const now = new Date();
    const triggersData: Array<{ scheduledEventId: number; triggerDate: Date; status: string }> = [];

    for (let i = 0; i <= 5; i++) {
      const targetMonthOffset = i * stepMonths;
      const targetYear = now.getFullYear();
      const targetMonth = now.getMonth() + targetMonthOffset;
      const d = new Date(Date.UTC(targetYear, targetMonth, day, hours, minutes, 0));

      triggersData.push({
        scheduledEventId: event.id,
        triggerDate: d,
        status: 'pending'
      });
    }

    await this.prisma.eventTrigger.createMany({
      data: triggersData
    });

    return this.findScheduledEventById(event.id);
  }

  async updateScheduledEvent(id: number, data: {
    title?: string;
    description?: string;
    targetType?: string;
    accountId?: number;
    tenantId?: number;
    apartmentId?: number;
    frequency?: string;
    dayOfMonth?: number;
    timeOfDay?: string;
    sendTelegram?: boolean;
    telegramTemplate?: string;
    active?: boolean;
  }) {
    const existing = await this.prisma.scheduledEvent.findUnique({ where: { id: Number(id) } });
    if (!existing) throw new NotFoundException(`Scheduled event #${id} not found`);

    const updated = await this.prisma.scheduledEvent.update({
      where: { id: Number(id) },
      data: {
        ...(data.title ? { title: data.title.trim() } : {}),
        ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
        ...(data.targetType ? { targetType: data.targetType } : {}),
        ...(data.accountId !== undefined ? { accountId: data.accountId ? Number(data.accountId) : null } : {}),
        ...(data.tenantId !== undefined ? { tenantId: data.tenantId ? Number(data.tenantId) : null } : {}),
        ...(data.apartmentId !== undefined ? { apartmentId: data.apartmentId ? Number(data.apartmentId) : null } : {}),
        ...(data.frequency ? { frequency: data.frequency } : {}),
        ...(data.dayOfMonth ? { dayOfMonth: Number(data.dayOfMonth) } : {}),
        ...(data.timeOfDay ? { timeOfDay: data.timeOfDay.trim() } : {}),
        ...(data.sendTelegram !== undefined ? { sendTelegram: Boolean(data.sendTelegram) } : {}),
        ...(data.telegramTemplate !== undefined ? { telegramTemplate: data.telegramTemplate?.trim() || null } : {}),
        ...(data.active !== undefined ? { active: Boolean(data.active) } : {})
      }
    });

    // Recalculate pending triggers with updated schedule parameters
    await this.prisma.eventTrigger.deleteMany({
      where: {
        scheduledEventId: updated.id,
        status: 'pending'
      }
    });

    const day = Math.min(Math.max(Number(updated.dayOfMonth) || 20, 1), 31);
    const freq = updated.frequency || 'monthly';
    const stepMonths = freq === 'quarterly' ? 3 : 1;
    const timeOfDayStr = updated.timeOfDay || '10:00';

    const [rawH, rawM] = timeOfDayStr.split(':').map(Number);
    const hours = isNaN(rawH) ? 10 : rawH;
    const minutes = isNaN(rawM) ? 0 : rawM;

    const now = new Date();
    const triggersData: Array<{ scheduledEventId: number; triggerDate: Date; status: string }> = [];

    for (let i = 0; i <= 5; i++) {
      const targetMonthOffset = i * stepMonths;
      const targetYear = now.getFullYear();
      const targetMonth = now.getMonth() + targetMonthOffset;
      const d = new Date(Date.UTC(targetYear, targetMonth, day, hours, minutes, 0));

      triggersData.push({
        scheduledEventId: updated.id,
        triggerDate: d,
        status: 'pending'
      });
    }

    await this.prisma.eventTrigger.createMany({
      data: triggersData
    });

    return this.findScheduledEventById(id);
  }

  async deleteScheduledEvent(id: number) {
    const existing = await this.prisma.scheduledEvent.findUnique({ where: { id: Number(id) } });
    if (!existing) throw new NotFoundException(`Scheduled event #${id} not found`);

    await this.prisma.scheduledEvent.delete({ where: { id: Number(id) } });
    return { success: true, message: `Event #${id} deleted` };
  }

  async updateEventTrigger(triggerId: number, data: { status?: string; comment?: string }) {
    const trigger = await this.prisma.eventTrigger.findUnique({ where: { id: Number(triggerId) } });
    if (!trigger) throw new NotFoundException(`Event trigger #${triggerId} not found`);

    const updated = await this.prisma.eventTrigger.update({
      where: { id: Number(triggerId) },
      data: {
        ...(data.status ? { status: data.status, processedAt: data.status === 'processed' ? new Date() : trigger.processedAt } : {}),
        ...(data.comment !== undefined ? { comment: data.comment } : {})
      },
      include: { scheduledEvent: true }
    });

    return this.serialize(updated);
  }

  async getPendingTriggersCount() {
    const count = await this.prisma.eventTrigger.count({
      where: {
        status: 'pending',
        triggerDate: {
          lte: new Date()
        }
      }
    });
    return { count };
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
