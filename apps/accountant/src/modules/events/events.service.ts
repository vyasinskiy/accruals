import { Injectable, Logger, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientProxy } from '@nestjs/microservices';
import { MeterSubmissionService } from '../meter-submission/meter-submission.service';
import { S3StorageService } from '../s3/s3-storage.service';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Storage: S3StorageService,
    private readonly meterSubmissionService: MeterSubmissionService,
    @Inject('NOTIFICATIONS_SERVICE') private readonly notificationsClient: ClientProxy,
  ) {}

  private serialize(obj: any) {
    return JSON.parse(JSON.stringify(obj, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ));
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleScheduledEventsCheck() {
    const now = new Date();
    try {
      const pendingTriggers = await this.prisma.eventTrigger.findMany({
        where: {
          status: 'pending',
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

      if (pendingTriggers.length === 0) return;

      for (const trigger of pendingTriggers) {
        const event = trigger.scheduledEvent;
        if (!event) continue;

        const reminderFreq = event.reminderFrequency || 'weekly';
        let shouldSend = false;
        let isReminder = false;

        if (!trigger.sentTelegramAt) {
          shouldSend = true;
          isReminder = false;
        } else if (reminderFreq !== 'none') {
          const diffMs = now.getTime() - new Date(trigger.sentTelegramAt).getTime();
          const dayMs = 24 * 60 * 60 * 1000;
          if (reminderFreq === 'daily' && diffMs >= dayMs) {
            shouldSend = true;
            isReminder = true;
          } else if (reminderFreq === 'weekly' && diffMs >= 7 * dayMs) {
            shouldSend = true;
            isReminder = true;
          }
        }

        if (shouldSend) {
          try {
            switch (event.eventType) {
              case 'meter_submission':
                await this.meterSubmissionService.processMeterSubmissionTrigger(event, trigger, isReminder);
                break;
              case 'rent_payment':
                // TODO: Add specialized logic for rent payments in the future, if needed.
                // For now, emit a generic scheduled event or a specific rent_payment event.
                this.notificationsClient.emit('scheduled_event_triggered', {
                  eventId: event.id,
                  triggerId: trigger.id,
                  title: event.title,
                  description: event.description,
                  targetType: event.targetType,
                  frequency: event.frequency,
                  reminderFrequency: event.reminderFrequency,
                  dayOfMonth: event.dayOfMonth,
                  timeOfDay: event.timeOfDay,
                  telegramTemplate: event.telegramTemplate,
                  createdAt: event.createdAt,
                  isReminder
                });
                break;
              case 'notification':
              default:
                this.notificationsClient.emit('scheduled_event_triggered', {
                  eventId: event.id,
                  triggerId: trigger.id,
                  title: event.title,
                  description: event.description,
                  targetType: event.targetType,
                  frequency: event.frequency,
                  reminderFrequency: event.reminderFrequency,
                  dayOfMonth: event.dayOfMonth,
                  timeOfDay: event.timeOfDay,
                  telegramTemplate: event.telegramTemplate,
                  createdAt: event.createdAt,
                  isReminder
                });
                break;
            }

            await this.prisma.eventTrigger.update({
              where: { id: trigger.id },
              data: { sentTelegramAt: now }
            });

            this.logger.log(`Emitted scheduled_event_triggered for trigger #${trigger.id} (event #${event.id}, isReminder=${isReminder})`);
          } catch (err: unknown) {
            this.logger.error(`Failed to emit scheduled_event_triggered for trigger #${trigger.id}`, err);
          }
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
        },
        attachments: {
          orderBy: { createdAt: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return events.map((event: any) => ({
      ...this.serialize(event),
      attachments: (event.attachments || []).map((att: any) => ({
        ...this.serialize(att),
        downloadUrl: this.s3Storage.getSignedDownloadUrl(att.s3Key) || `/api/accountant/events/${event.id}/attachments/${att.id}/download`
      }))
    }));
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
        },
        attachments: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });
    if (!event) {
      throw new NotFoundException(`Scheduled event #${id} not found`);
    }

    return {
      ...this.serialize(event),
      attachments: (event.attachments || []).map((att: any) => ({
        ...this.serialize(att),
        downloadUrl: this.s3Storage.getSignedDownloadUrl(att.s3Key) || `/api/accountant/events/${event.id}/attachments/${att.id}/download`
      }))
    };
  }

  async createScheduledEvent(data: {
    title: string;
    description?: string;
    eventType?: string;
    targetType?: string;
    accountId?: number;
    tenantId?: number;
    apartmentId?: number;
    frequency?: string;
    reminderFrequency?: string;
    dayOfMonth?: number;
    timeOfDay?: string;
    sendTelegram?: boolean;
    telegramTemplate?: string;
  }) {
    const day = Math.min(Math.max(Number(data.dayOfMonth) || 20, 1), 31);
    const freq = data.frequency || 'monthly';
    const reminderFreq = data.reminderFrequency || 'weekly';
    const timeOfDayStr = data.timeOfDay?.trim() || '10:00';

    const event = await this.prisma.scheduledEvent.create({
      data: {
        title: data.title.trim(),
        description: data.description?.trim() || null,
        eventType: data.eventType || 'notification',
        targetType: data.targetType || 'general',
        accountId: data.accountId ? Number(data.accountId) : null,
        tenantId: data.tenantId ? Number(data.tenantId) : null,
        apartmentId: data.apartmentId ? Number(data.apartmentId) : null,
        frequency: freq,
        reminderFrequency: reminderFreq,
        dayOfMonth: day,
        timeOfDay: timeOfDayStr,
        sendTelegram: data.sendTelegram ?? true,
        telegramTemplate: data.telegramTemplate?.trim() || null,
        active: true
      }
    });

    const triggersData = this.buildTriggersForEvent({
      id: event.id,
      frequency: event.frequency,
      dayOfMonth: event.dayOfMonth,
      timeOfDay: event.timeOfDay
    });

    await this.prisma.eventTrigger.createMany({
      data: triggersData
    });

    return this.findScheduledEventById(event.id);
  }

  async updateScheduledEvent(id: number, data: {
    title?: string;
    description?: string;
    eventType?: string;
    targetType?: string;
    accountId?: number;
    tenantId?: number;
    apartmentId?: number;
    frequency?: string;
    reminderFrequency?: string;
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
        ...(data.eventType ? { eventType: data.eventType } : {}),
        ...(data.targetType ? { targetType: data.targetType } : {}),
        ...(data.accountId !== undefined ? { accountId: data.accountId ? Number(data.accountId) : null } : {}),
        ...(data.tenantId !== undefined ? { tenantId: data.tenantId ? Number(data.tenantId) : null } : {}),
        ...(data.apartmentId !== undefined ? { apartmentId: data.apartmentId ? Number(data.apartmentId) : null } : {}),
        ...(data.frequency ? { frequency: data.frequency } : {}),
        ...(data.reminderFrequency ? { reminderFrequency: data.reminderFrequency } : {}),
        ...(data.dayOfMonth ? { dayOfMonth: Number(data.dayOfMonth) } : {}),
        ...(data.timeOfDay ? { timeOfDay: data.timeOfDay.trim() } : {}),
        ...(data.sendTelegram !== undefined ? { sendTelegram: Boolean(data.sendTelegram) } : {}),
        ...(data.telegramTemplate !== undefined ? { telegramTemplate: data.telegramTemplate?.trim() || null } : {}),
        ...(data.active !== undefined ? { active: Boolean(data.active) } : {})
      }
    });

    await this.prisma.eventTrigger.deleteMany({
      where: {
        scheduledEventId: updated.id,
        status: 'pending'
      }
    });

    const triggersData = this.buildTriggersForEvent({
      id: updated.id,
      frequency: updated.frequency,
      dayOfMonth: updated.dayOfMonth,
      timeOfDay: updated.timeOfDay
    });

    await this.prisma.eventTrigger.createMany({
      data: triggersData
    });

    return this.findScheduledEventById(id);
  }

  private buildTriggersForEvent(event: { id: number; frequency: string; dayOfMonth: number; timeOfDay: string }) {
    const freq = event.frequency || 'monthly';
    const day = Math.min(Math.max(Number(event.dayOfMonth) || 20, 1), 31);
    const timeOfDayStr = event.timeOfDay || '10:00';

    const [rawH, rawM] = timeOfDayStr.split(':').map(Number);
    const hours = isNaN(rawH) ? 10 : rawH;
    const minutes = isNaN(rawM) ? 0 : rawM;

    const now = new Date();
    const triggersData: Array<{ scheduledEventId: number; triggerDate: Date; status: string }> = [];

    if (freq === 'daily') {
      for (let i = 0; i <= 13; i++) {
        const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + i, hours, minutes, 0));
        triggersData.push({
          scheduledEventId: event.id,
          triggerDate: d,
          status: 'pending'
        });
      }
    } else if (freq === 'weekly') {
      for (let i = 0; i <= 7; i++) {
        const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + (i * 7), hours, minutes, 0));
        triggersData.push({
          scheduledEventId: event.id,
          triggerDate: d,
          status: 'pending'
        });
      }
    } else {
      const stepMonths = freq === 'quarterly' ? 3 : 1;
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
    }

    return triggersData;
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

  async attachEventDocument(data: {
    scheduledEventId?: number;
    eventTriggerId?: number;
    fileName: string;
    fileBuffer: Buffer;
    mimeType?: string;
    telegramFileId?: string;
    uploadedBy?: string;
  }) {
    let scheduledEventId = data.scheduledEventId ? Number(data.scheduledEventId) : undefined;
    let eventTriggerId = data.eventTriggerId ? Number(data.eventTriggerId) : undefined;

    if (!scheduledEventId && eventTriggerId) {
      const trigger = await this.prisma.eventTrigger.findUnique({
        where: { id: eventTriggerId }
      });
      if (trigger) {
        scheduledEventId = trigger.scheduledEventId;
      }
    }

    if (!scheduledEventId) {
      throw new Error('scheduledEventId or valid eventTriggerId is required');
    }

    const s3Key = this.s3Storage.buildAttachmentKey(scheduledEventId, data.fileName);
    await this.s3Storage.uploadBuffer(s3Key, data.fileBuffer, data.mimeType || 'application/octet-stream');

    const attachment = await this.prisma.eventAttachment.create({
      data: {
        scheduledEventId,
        eventTriggerId: eventTriggerId || null,
        fileName: data.fileName,
        s3Key,
        fileSize: data.fileBuffer.length,
        mimeType: data.mimeType || 'application/octet-stream',
        telegramFileId: data.telegramFileId || null,
        uploadedBy: data.uploadedBy || 'system',
      }
    });

    const downloadUrl = this.s3Storage.getSignedDownloadUrl(s3Key) || `/api/accountant/events/attachments/${attachment.id}/download`;

    return {
      ...this.serialize(attachment),
      downloadUrl
    };
  }

  async findScheduledEventsFiltered(filters: { tenantId?: number; apartmentId?: number; accountId?: number; activeOnly?: boolean }) {
    const where: any = {};
    if (filters.tenantId) where.tenantId = Number(filters.tenantId);
    if (filters.apartmentId) where.apartmentId = Number(filters.apartmentId);
    if (filters.accountId) where.accountId = Number(filters.accountId);
    if (filters.activeOnly) where.active = true;

    const events = await this.prisma.scheduledEvent.findMany({
      where,
      include: {
        account: { include: { apartment: true } },
        tenant: { include: { user: true, apartment: true } },
        apartment: true,
        attachments: { orderBy: { createdAt: 'desc' } }
      },
      orderBy: { createdAt: 'desc' }
    });

    return events.map((event: any) => ({
      ...this.serialize(event),
      attachments: (event.attachments || []).map((att: any) => ({
        ...this.serialize(att),
        downloadUrl: this.s3Storage.getSignedDownloadUrl(att.s3Key) || `/api/accountant/events/attachments/${att.id}/download`
      }))
    }));
  }

  async getEventAttachments(scheduledEventId: number) {
    const attachments = await this.prisma.eventAttachment.findMany({
      where: { scheduledEventId: Number(scheduledEventId) },
      orderBy: { createdAt: 'desc' }
    });

    return attachments.map((att) => ({
      ...this.serialize(att),
      downloadUrl: this.s3Storage.getSignedDownloadUrl(att.s3Key) || `/api/accountant/events/attachments/${att.id}/download`
    }));
  }

  async deleteEventAttachment(id: number) {
    const att = await this.prisma.eventAttachment.findUnique({
      where: { id: Number(id) }
    });
    if (!att) {
      throw new NotFoundException(`Attachment #${id} not found`);
    }
    await this.prisma.eventAttachment.delete({
      where: { id: Number(id) }
    });
    return { success: true };
  }
}
