import { Injectable, Logger, Inject, NotFoundException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma } from '../../generated/client';
import { S3StorageService } from '../s3/s3-storage.service';
import { MeterSubmissionService } from '../meter-submission/meter-submission.service';
import { EventsService } from '../events/events.service';

@Injectable()
export class AccountantService {
  private readonly logger = new Logger(AccountantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Storage: S3StorageService,
    @Inject('NOTIFICATIONS_SERVICE') private readonly notificationsClient: ClientProxy,
    private readonly meterSubmissionService: MeterSubmissionService,
    private readonly eventsService: EventsService
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

  async createPayment(data: {
    tenantId?: number;
    userId?: number;
    userName?: string;
    amount: number | string;
    receiptPhotoId?: string | null;
    comment?: string | null;
    createdAt?: string | Date;
    status?: string;
  }) {
    let targetUserId = data.userId;
    let targetUserName = data.userName;

    if (data.tenantId) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: Number(data.tenantId) },
        include: { user: true },
      });

      if (!tenant) {
        throw new Error(`Tenant with ID ${data.tenantId} not found in accounting system.`);
      }
      targetUserId = tenant.userId;
      if (!targetUserName) {
        targetUserName = tenant.user?.name || `Tenant #${tenant.id}`;
      }
    }

    if (!targetUserId) {
      throw new Error(`Either tenantId or userId must be provided to create a payment.`);
    }

    const paymentDate = data.createdAt ? new Date(data.createdAt) : new Date();

    const result = await this.prisma.payment.create({
      data: {
        userId: targetUserId,
        userName: targetUserName || null,
        amount: data.amount,
        receiptPhotoId: data.receiptPhotoId || null,
        comment: data.comment || null,
        status: data.status || 'unconfirmed',
        createdAt: isNaN(paymentDate.getTime()) ? new Date() : paymentDate,
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

  async updateAccount(accountId: number, data: { customLabel?: string | null; meterSubmissionDay?: number | null }) {
    const result = await this.prisma.account.update({
      where: { id: accountId },
      data,
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
    
    if (data.rentPaymentDay) {
      await this.eventsService.createScheduledEvent({
        title: `Оплата аренды (${data.name})`,
        description: `Напоминание об оплате аренды для ${data.name}`,
        eventType: 'rent_payment',
        targetType: 'tenant',
        tenantId: user.tenantProfile?.id,
        frequency: 'monthly',
        dayOfMonth: data.rentPaymentDay,
        timeOfDay: '10:00',
        sendTelegram: true
      });
    }

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
    const results = await this.prisma.account.findMany({
      where,
      include: {
        apartment: true,
        _count: { select: { invoices: true } }
      },
      orderBy: [{ externalId: 'asc' }]
    });
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

  async findPayments(filters: { userId?: number; status?: string; userName?: string; accountId?: number } = {}) {
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
    if (filters.accountId) {
      const account = await this.prisma.account.findUnique({
        where: { id: Number(filters.accountId) },
        include: { apartment: { include: { tenants: true } } }
      });
      if (account?.apartment?.tenants?.length) {
        const userIds = account.apartment.tenants.map(t => t.userId);
        where.userId = { in: userIds };
      } else {
        // If no tenants, return no payments
        where.userId = -1;
      }
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

  async findAccountById(id: number) {
    const result = await this.prisma.account.findUnique({
      where: { id },
      include: {
        apartment: true,
        _count: { select: { invoices: true } }
      }
    });
    return this.serialize(result);
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

  async bulkDeleteInvoices(ids: number[]) {
    return this.prisma.invoice.deleteMany({
      where: {
        id: { in: ids }
      }
    });
  }

  async deletePayment(id: number) {
    return this.prisma.payment.delete({ where: { id } });
  }

  async deleteMeterSubmissionEvent(id: number) {
    return this.prisma.meterSubmissionEvent.delete({ where: { id } });
  }

  async findTenants(includeDeleted: boolean = false) {
    const whereClause = includeDeleted ? {} : { status: { not: 'deleted' } };
    const results = await this.prisma.tenant.findMany({
      where: whereClause,
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

    if (data.rentPaymentDay) {
      await this.eventsService.createScheduledEvent({
        title: `Оплата аренды (${data.name})`,
        description: `Напоминание об оплате аренды для ${data.name}`,
        eventType: 'rent_payment',
        targetType: 'tenant',
        tenantId: tenant.id,
        frequency: 'monthly',
        dayOfMonth: data.rentPaymentDay,
        timeOfDay: '10:00',
        sendTelegram: true
      });
    }

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
    
    const updatedTenant = await this.prisma.tenant.update({
      where: { id },
      data: { status: 'deleted' }
    });

    await this.prisma.scheduledEvent.updateMany({
      where: { tenantId: id },
      data: { active: false }
    });

    return updatedTenant;
  }

  async forceDeleteTenant(id: number) {
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
