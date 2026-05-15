import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class TenantReminderService {
  private readonly logger = new Logger(TenantReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('NOTIFICATIONS_SERVICE') private readonly notificationsClient: ClientProxy
  ) {}

  // Run every day at 09:00 AM
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async handleRentReminders() {
    this.logger.log('Running daily rent reminder check...');
    
    const today = new Date();
    const currentDay = today.getDate();

    try {
      const tenantsToRemind = await this.prisma.tenant.findMany({
        where: {
          status: 'active',
          rentPaymentDay: currentDay,
          rentAmount: { not: null }
        },
        include: {
          user: { include: { identities: true } },
          apartment: true
        }
      });

      if (tenantsToRemind.length === 0) {
        this.logger.log('No tenants to remind today.');
        return;
      }

      for (const tenant of tenantsToRemind) {
        const tgIdentity = tenant.user.identities.find(i => i.platform === 'telegram');
        
        if (tgIdentity && tenant.rentAmount) {
          this.notificationsClient.emit('remind_rent_payment', {
            chatId: tgIdentity.externalId,
            rentAmount: tenant.rentAmount.toString(),
            apartmentAddress: tenant.apartment?.address || 'Неизвестно'
          });
          this.logger.log(`Sent reminder event for tenant ${tenant.id} (Chat ID: ${tgIdentity.externalId})`);
        }
      }
    } catch (error) {
      this.logger.error('Failed to run rent reminder cron job', error);
    }
  }
}
