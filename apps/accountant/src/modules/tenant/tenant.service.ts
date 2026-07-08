import { Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('NOTIFICATIONS_SERVICE') private readonly notificationsClient: ClientProxy
  ) {}

  private serialize(data: any): any {
    if (!data) return data;
    return JSON.parse(JSON.stringify(data, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ));
  }

  async addPayment(data: { tenantId: number; amount: number; receiptPhotoId?: string; isPaidToday: boolean }) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: data.tenantId },
      include: { user: true, apartment: true }
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    if (tenant.status !== 'active') {
      throw new Error('Tenant is not active');
    }

    const payment = await this.prisma.payment.create({
      data: {
        userId: tenant.userId,
        userName: tenant.user.name || 'Unknown',
        amount: data.amount,
        receiptPhotoId: data.receiptPhotoId,
        status: 'unconfirmed',
      }
    });

    // Notify about new payment
    this.notificationsClient.emit('payment_created', {
      paymentId: payment.id,
      userName: tenant.user.name,
      apartmentAddress: tenant.apartment?.address || 'Не указан',
      amount: data.amount,
      receiptPhotoId: data.receiptPhotoId
    });

    return this.serialize(payment);
  }

  async getInvoices(tenantId: number) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { apartment: { include: { accounts: true } } }
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    if (!tenant.apartment) {
      return this.serialize([]);
    }

    const accountIds = tenant.apartment.accounts.map((acc: any) => acc.id);
    const invoices = await this.prisma.invoice.findMany({
      where: { accountId: { in: accountIds }, available: true },
      orderBy: { periodLabel: 'desc' },
      take: 10
    });

    return this.serialize(invoices);
  }

  async getCurrentDebt(tenantId: number) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { user: true, apartment: { include: { accounts: true } } }
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    if (!tenant.apartment) {
      return this.serialize({ tenant: tenant.user, debts: [] });
    }

    const accountIds = tenant.apartment.accounts.map((acc: any) => acc.id);
    const debts = [];

    for (const accountId of accountIds) {
      const accrual = await this.prisma.accrual.findFirst({
        where: { accountId },
        orderBy: { periodId: 'desc' }
      });
      if (accrual) {
        debts.push(accrual);
      }
    }

    return this.serialize({ tenant: tenant.user, debts });
  }
}
