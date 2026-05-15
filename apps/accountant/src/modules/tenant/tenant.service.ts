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

  async addPayment(data: { telegramId: string | number; amount: number; receiptPhotoId?: string; isPaidToday: boolean }) {
    const identity = await this.prisma.userIdentity.findUnique({
      where: { platform_externalId: { platform: 'telegram', externalId: data.telegramId.toString() } },
      include: { user: { include: { tenantProfile: { include: { apartment: true } } } } }
    });

    const user = identity?.user;

    if (!user || !user.tenantProfile) {
      throw new NotFoundException('Tenant not found');
    }

    if (user.tenantProfile.status !== 'active') {
      throw new Error('Tenant is not active');
    }

    const payment = await this.prisma.payment.create({
      data: {
        userId: user.id,
        userName: user.name || 'Unknown',
        amount: data.amount,
        receiptPhotoId: data.receiptPhotoId,
        status: 'unconfirmed',
      }
    });

    // Notify about new payment
    this.notificationsClient.emit('payment_created', {
      paymentId: payment.id,
      userName: user.name,
      apartmentAddress: user.tenantProfile.apartment?.address || 'Не указан',
      amount: data.amount,
      receiptPhotoId: data.receiptPhotoId
    });

    return this.serialize(payment);
  }

  async getInvoices(telegramId: string | number) {
    const identity = await this.prisma.userIdentity.findUnique({
      where: { platform_externalId: { platform: 'telegram', externalId: telegramId.toString() } },
      include: { user: { include: { tenantProfile: { include: { apartment: { include: { accounts: true } } } } } } }
    });

    const user = identity?.user;

    if (!user || !user.tenantProfile) {
      throw new NotFoundException('Tenant not found');
    }

    if (!user.tenantProfile.apartment) {
      return this.serialize([]);
    }

    const accountIds = user.tenantProfile.apartment.accounts.map((acc: any) => acc.id);
    const invoices = await this.prisma.invoice.findMany({
      where: { accountId: { in: accountIds }, available: true },
      orderBy: { periodLabel: 'desc' },
      take: 10
    });

    return this.serialize(invoices);
  }

  async getCurrentDebt(telegramId: string | number) {
    const identity = await this.prisma.userIdentity.findUnique({
      where: { platform_externalId: { platform: 'telegram', externalId: telegramId.toString() } },
      include: { user: { include: { tenantProfile: { include: { apartment: { include: { accounts: true } } } } } } }
    });

    const user = identity?.user;

    if (!user || !user.tenantProfile) {
      throw new NotFoundException('Tenant not found');
    }

    if (!user.tenantProfile.apartment) {
      return this.serialize({ tenant: user, debts: [] });
    }

    const accountIds = user.tenantProfile.apartment.accounts.map((acc: any) => acc.id);
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

    return this.serialize({ tenant: user, debts });
  }
}
