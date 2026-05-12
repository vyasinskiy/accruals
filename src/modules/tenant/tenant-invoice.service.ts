import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class TenantInvoiceService {
  private readonly logger = new Logger(TenantInvoiceService.name);

  constructor(private readonly prisma: PrismaService) {}

  private serialize(data: any): any {
    if (!data) return data;
    return JSON.parse(JSON.stringify(data, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ));
  }

  async getInvoices(telegramId: string | number) {
    const user = await this.prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) },
      include: { tenantProfile: { include: { apartment: { include: { accounts: true } } } } }
    });

    if (!user || !user.tenantProfile) {
      throw new NotFoundException('Tenant not found');
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
    const user = await this.prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) },
      include: { tenantProfile: { include: { apartment: { include: { accounts: true } } } } }
    });

    if (!user || !user.tenantProfile) {
      throw new NotFoundException('Tenant not found');
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
