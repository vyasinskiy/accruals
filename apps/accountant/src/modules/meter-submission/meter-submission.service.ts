import { Injectable, Logger, Inject, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class MeterSubmissionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MeterSubmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('NOTIFICATIONS_SERVICE') private readonly notificationsClient: ClientProxy
  ) {}

  
  async onApplicationBootstrap() {
    this.logger.log('Meter event service started.');
  }

  async processMeterSubmissionTrigger(scheduledEvent: any, trigger: any, isReminder: boolean) {
    this.logger.log(`Processing meter submission trigger for event ${scheduledEvent.id}, isReminder: ${isReminder}`);
    const { periodId, periodLabel, year, month } = this.getCurrentPeriod();
    
    // Find target accounts based on ScheduledEvent targetType
    let accounts: any[] = [];
    if (scheduledEvent.targetType === 'general') {
      accounts = await this.prisma.account.findMany({ include: { apartment: true } });
    } else if (scheduledEvent.targetType === 'account' && scheduledEvent.accountId) {
      const account = await this.prisma.account.findUnique({ where: { id: scheduledEvent.accountId }, include: { apartment: true } });
      if (account) accounts.push(account);
    } else if (scheduledEvent.targetType === 'tenant' && scheduledEvent.tenantId) {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: scheduledEvent.tenantId } });
      if (tenant && tenant.apartmentId) {
        accounts = await this.prisma.account.findMany({ where: { apartmentId: tenant.apartmentId }, include: { apartment: true } });
      }
    } else if (scheduledEvent.targetType === 'apartment' && scheduledEvent.apartmentId) {
      accounts = await this.prisma.account.findMany({ where: { apartmentId: scheduledEvent.apartmentId }, include: { apartment: true } });
    }

    const now = new Date();

    for (const account of accounts) {
      // Find or create MeterSubmissionEvent for this period
      let meterEvent = await this.prisma.meterSubmissionEvent.findUnique({
        where: { accountId_periodId: { accountId: account.id, periodId } },
        include: { account: { include: { apartment: true } } }
      });

      if (!meterEvent) {
        meterEvent = await this.prisma.meterSubmissionEvent.create({
          data: {
            accountId: account.id,
            periodId,
            periodLabel,
            targetDate: now,
            notificationSent: false
          },
          include: { account: { include: { apartment: true } } }
        });
      }

      if (isReminder) {
        if (['PENDING', 'RECEIVED'].includes(meterEvent.status)) {
          await this.sendMeterNotification(meterEvent, scheduledEvent.id, 'meter_submission_reminder');
          await this.prisma.meterSubmissionEvent.update({
            where: { id: meterEvent.id },
            data: { lastReminderSent: now }
          });
        }
      } else {
        await this.sendMeterNotification(meterEvent, scheduledEvent.id, 'meter_submission_required');
        await this.prisma.meterSubmissionEvent.update({
          where: { id: meterEvent.id },
          data: { notificationSent: true }
        });
      }
    }
  }

  private async sendMeterNotification(meterEvent: any, scheduledEventId: number, pattern: string) {
    try {
      this.logger.log(`Sending ${pattern} command for account ${meterEvent.account.externalId}`);
      const res = await firstValueFrom(
        this.notificationsClient.send<{ success: boolean }>(pattern, {
          eventId: meterEvent.id,
          scheduledEventId: scheduledEventId,
          accountExternalId: meterEvent.account.externalId,
          accountLabel: meterEvent.account.customLabel || [meterEvent.account.accountNumber, meterEvent.account.accountLabel].filter(Boolean).join(' ') || meterEvent.account.externalId,
          apartmentAddress: meterEvent.account.apartment?.address || meterEvent.account.apartment?.externalId || 'Неизвестно',
          periodLabel: meterEvent.periodLabel
        })
      );
      if (res && res.success) {
        this.logger.log(`Notification sent successfully for meter event ${meterEvent.id}`);
      } else {
        this.logger.warn(`Notification send returned failure for meter event ${meterEvent.id}`);
      }
    } catch (err: any) {
      this.logger.error(`Failed to send notification for meter event ${meterEvent.id}: ${err.message}`);
    }
  }

  private getCurrentPeriod() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-12
    const periodId = `${year}${month.toString().padStart(2, '0')}`;
    
    const monthNames = [
      'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
      'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
    ];
    const periodLabel = `${monthNames[now.getMonth()]} ${year}`;
    
    return { periodId, periodLabel, year, month };
  }

  async submitReadings(eventId: number) {
    const event = await this.prisma.meterSubmissionEvent.findUnique({
      where: { id: eventId },
      include: {
        account: {
          include: {
            apartment: true
          }
        }
      }
    });

    if (!event) {
      return { success: false, message: 'Событие не найдено' };
    }

    if (event.status === 'SUBMITTED') {
      return { success: true, alreadySubmitted: true, event };
    }

    const updated = await this.prisma.meterSubmissionEvent.update({
      where: { id: eventId },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date()
      },
      include: {
        account: {
          include: {
            apartment: true
          }
        }
      }
    });

    return { success: true, alreadySubmitted: false, event: updated };
  }

  async markReceived(eventId: number) {
    const event = await this.prisma.meterSubmissionEvent.findUnique({
      where: { id: eventId },
      include: { account: { include: { apartment: true } } }
    });
    if (!event) return { success: false, message: 'Событие не найдено' };

    const updated = await this.prisma.meterSubmissionEvent.update({
      where: { id: eventId },
      data: { status: 'RECEIVED', receivedAt: new Date() },
      include: { account: { include: { apartment: true } } }
    });
    return { success: true, event: updated };
  }

  async submitValue(eventId: number, value: string) {
    const event = await this.prisma.meterSubmissionEvent.findUnique({
      where: { id: eventId },
      include: { account: { include: { apartment: true } } }
    });
    if (!event) return { success: false, message: 'Событие не найдено' };

    const updated = await this.prisma.meterSubmissionEvent.update({
      where: { id: eventId },
      data: { status: 'RECEIVED', receivedAt: new Date(), readingsValue: value },
      include: { account: { include: { apartment: true } } }
    });
    return { success: true, event: updated };
  }

  async completeWithoutSubmission(eventId: number) {
    const event = await this.prisma.meterSubmissionEvent.findUnique({
      where: { id: eventId },
      include: { account: { include: { apartment: true } } }
    });
    if (!event) return { success: false, message: 'Событие не найдено' };

    const updated = await this.prisma.meterSubmissionEvent.update({
      where: { id: eventId },
      data: { status: 'COMPLETED_WITHOUT_SUBMISSION' },
      include: { account: { include: { apartment: true } } }
    });
    return { success: true, event: updated };
  }
}
