import { Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class TenantPaymentService {
  private readonly logger = new Logger(TenantPaymentService.name);

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
    const user = await this.prisma.user.findUnique({
      where: { telegramId: BigInt(data.telegramId) },
      include: { tenantProfile: { include: { apartment: true } } }
    });

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

    const isTodayStr = data.isPaidToday ? 'Да' : 'Нет';
    
    // Notify all admins
    const admins = await this.prisma.user.findMany({ where: { role: 'admin' } });
    for (const admin of admins) {
        this.notificationsClient.emit('notify_admin', {
          targetChatId: admin.telegramId.toString(),
          message: `💰 <b>Новая оплата от арендатора!</b>\n\nАрендатор: ${user.name}\nКвартира: ${user.tenantProfile.apartment.address || 'Не указан'}\nСумма: ${data.amount}\nОплачено сегодня: ${isTodayStr}\nОжидает подтверждения.`,
          paymentId: payment.id,
          receiptPhotoId: data.receiptPhotoId
        });
    }

    return this.serialize(payment);
  }
}
