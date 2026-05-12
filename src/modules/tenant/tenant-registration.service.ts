import { Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class TenantRegistrationService {
  private readonly logger = new Logger(TenantRegistrationService.name);

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

  async registerTenant(data: { name: string; telegramId: string | number; apartmentId: number; rentPaymentDay: number }) {
    const telegramId = BigInt(data.telegramId);

    let user = await this.prisma.user.findUnique({
      where: { telegramId }
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          telegramId,
          name: data.name,
          role: 'tenant'
        }
      });
    }

    const existingProfile = await this.prisma.tenant.findUnique({
      where: { userId: user.id }
    });

    if (existingProfile) {
      return this.serialize({ ...user, tenantProfile: existingProfile });
    }

    const tenant = await this.prisma.tenant.create({
      data: {
        userId: user.id,
        apartmentId: data.apartmentId,
        rentPaymentDay: data.rentPaymentDay,
        status: 'pending',
      },
      include: { apartment: true }
    });

    // Notify all admins
    const admins = await this.prisma.user.findMany({ where: { role: 'admin' } });
    for (const admin of admins) {
        this.notificationsClient.emit('notify_admin', {
          targetChatId: admin.telegramId.toString(),
          message: `👤 <b>Новый запрос на регистрацию арендатора!</b>\n\nИмя: ${data.name}\nКвартира: ${tenant.apartment.address || 'Не указан'}\nДень оплаты: ${tenant.rentPaymentDay}\nОжидает подтверждения.`,
          tenantId: tenant.id
        });
    }

    return this.serialize({ ...user, tenantProfile: tenant });
  }

  async approveTenant(tenantId: number) {
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status: 'active' },
      include: { user: true }
    });
    
    // Optionally notify the tenant that they are approved
    this.notificationsClient.emit('notify_accrual', {
        chatId: tenant.user.telegramId.toString(),
        message: `✅ <b>Ваша регистрация подтверждена!</b>\n\nТеперь вы можете добавлять оплаты и просматривать квитанции.`
    });

    return this.serialize(tenant);
  }

  async rejectTenant(tenantId: number) {
    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status: 'rejected' }
    });
    return this.serialize(tenant);
  }

  async getTenantByTelegramId(telegramId: string | number) {
    const user = await this.prisma.user.findUnique({
      where: { telegramId: BigInt(telegramId) },
      include: { tenantProfile: { include: { apartment: { include: { accounts: true } } } } }
    });
    return this.serialize(user);
  }
}
