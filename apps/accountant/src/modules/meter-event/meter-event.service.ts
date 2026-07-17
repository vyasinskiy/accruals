import { Injectable, Logger, Inject, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class MeterEventService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MeterEventService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('NOTIFICATIONS_SERVICE') private readonly notificationsClient: ClientProxy
  ) {}

  async onApplicationBootstrap() {
    this.logger.log('Running startup meter events check...');
    await this.handleMeterChecks();
  }

  // Run every hour at the top of the hour
  @Cron('0 * * * *')
  async handleMeterChecks() {
    this.logger.log('Checking meter submission events...');
    try {
      await this.ensureEventsExistForCurrentMonth();
      await this.sendDueNotifications();
      await this.sendMondayReminders();
    } catch (e: any) {
      this.logger.error(`Failed to process meter checks: ${e.message}`, e.stack);
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

  async ensureEventsExistForCurrentMonth() {
    const { periodId, periodLabel, year, month } = this.getCurrentPeriod();
    const accounts = await this.prisma.account.findMany();
    
    // Get last day of the current month to prevent wrap-around if day > daysInMonth
    const daysInMonth = new Date(year, month, 0).getDate();

    for (const account of accounts) {
      // Calculate targetDate for this specific account
      const day = Math.min(account.meterSubmissionDay, daysInMonth);
      const targetDate = new Date(year, month - 1, day, 9, 0, 0);

      // Check if event already exists
      const existing = await this.prisma.meterSubmissionEvent.findUnique({
        where: {
          accountId_periodId: {
            accountId: account.id,
            periodId
          }
        }
      });

      if (!existing) {
        await this.prisma.meterSubmissionEvent.create({
          data: {
            accountId: account.id,
            periodId,
            periodLabel,
            targetDate
          }
        });
        this.logger.log(`Created meter submission event for account ${account.externalId} / period ${periodId} targetDate ${targetDate.toISOString()}`);
      }
    }
  }

  async sendDueNotifications() {
    const now = new Date();
    const events = await this.prisma.meterSubmissionEvent.findMany({
      where: {
        notificationSent: false,
        targetDate: { lte: now }
      },
      include: {
        account: {
          include: {
            apartment: true
          }
        }
      }
    });

    for (const event of events) {
      try {
        this.logger.log(`Sending meter submission required command for account ${event.account.externalId}`);
        const res = await firstValueFrom(
          this.notificationsClient.send<{ success: boolean }>('meter_submission_required', {
            eventId: event.id,
            accountExternalId: event.account.externalId,
            accountLabel: event.account.customLabel || [event.account.accountNumber, event.account.accountLabel].filter(Boolean).join(' ') || event.account.externalId,
            apartmentAddress: event.account.apartment.address || event.account.apartment.externalId || 'Неизвестно',
            periodLabel: event.periodLabel
          })
        );

        if (res && res.success) {
          await this.prisma.meterSubmissionEvent.update({
            where: { id: event.id },
            data: { notificationSent: true }
          });
          this.logger.log(`Notification sent and confirmed for event ${event.id}`);
        } else {
          this.logger.warn(`Notification send returned failure for event ${event.id}`);
        }
      } catch (err: any) {
        this.logger.error(`Failed to send notification for event ${event.id}: ${err.message}`);
      }
    }
  }

  async sendMondayReminders() {
    const now = new Date();
    const isMonday = now.getDay() === 1;
    if (!isMonday) return;

    // Calculate start of current week (Monday at 00:00:00)
    const startOfWeek = new Date(now);
    const day = startOfWeek.getDay();
    const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
    startOfWeek.setDate(diff);
    startOfWeek.setHours(0, 0, 0, 0);

    const events = await this.prisma.meterSubmissionEvent.findMany({
      where: {
        notificationSent: true,
        status: { in: ['PENDING', 'RECEIVED'] },
        targetDate: { lt: startOfWeek }, // Must be from previous week(s)
        OR: [
          { lastReminderSent: null },
          { lastReminderSent: { lt: startOfWeek } }
        ]
      },
      include: {
        account: {
          include: {
            apartment: true
          }
        }
      }
    });

    for (const event of events) {
      try {
        this.logger.log(`Sending meter submission reminder command for account ${event.account.externalId}`);
        const res = await firstValueFrom(
          this.notificationsClient.send<{ success: boolean }>('meter_submission_reminder', {
            eventId: event.id,
            accountExternalId: event.account.externalId,
            accountLabel: event.account.customLabel || [event.account.accountNumber, event.account.accountLabel].filter(Boolean).join(' ') || event.account.externalId,
            apartmentAddress: event.account.apartment.address || event.account.apartment.externalId || 'Неизвестно',
            periodLabel: event.periodLabel
          })
        );

        if (res && res.success) {
          await this.prisma.meterSubmissionEvent.update({
            where: { id: event.id },
            data: { lastReminderSent: now }
          });
          this.logger.log(`Reminder sent and confirmed for event ${event.id}`);
        } else {
          this.logger.warn(`Reminder send returned failure for event ${event.id}`);
        }
      } catch (err: any) {
        this.logger.error(`Failed to send reminder for event ${event.id}: ${err.message}`);
      }
    }
  }

  async markReceived(eventId: number) {
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

    const updated = await this.prisma.meterSubmissionEvent.update({
      where: { id: eventId },
      data: {
        status: 'RECEIVED',
        receivedAt: new Date()
      },
      include: {
        account: {
          include: {
            apartment: true
          }
        }
      }
    });

    return { success: true, event: updated };
  }

  async submitValue(eventId: number, value: string) {
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

    const updated = await this.prisma.meterSubmissionEvent.update({
      where: { id: eventId },
      data: {
        status: 'RECEIVED',
        receivedAt: new Date(),
        readingsValue: value
      },
      include: {
        account: {
          include: {
            apartment: true
          }
        }
      }
    });

    return { success: true, event: updated };
  }

  async completeWithoutSubmission(eventId: number) {
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

    const updated = await this.prisma.meterSubmissionEvent.update({
      where: { id: eventId },
      data: {
        status: 'COMPLETED_WITHOUT_SUBMISSION'
      },
      include: {
        account: {
          include: {
            apartment: true
          }
        }
      }
    });

    return { success: true, event: updated };
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
}
