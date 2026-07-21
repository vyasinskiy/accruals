import { Controller, Inject, Logger } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload, ClientProxy } from '@nestjs/microservices';
import { TelegramBotNotificationService } from './telegram-bot-notification.service';
import { Markup } from 'telegraf';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { config } from '../../common/config/config';

@Controller()
export class TelegramBotController {
  private readonly logger = new Logger(TelegramBotController.name);

  constructor(
    private readonly botService: TelegramBotNotificationService,
    private readonly prisma: PrismaService,
    @Inject('ACCOUNTANT_SERVICE') private readonly accountantClient: ClientProxy
  ) {}

  @EventPattern('payment_created')
  async handlePaymentCreated(@Payload() data: { 
    paymentId: number; 
    userName: string; 
    apartmentAddress: string; 
    amount: number; 
    receiptPhotoId: string;
  }) {
    const message = `💰 <b>Новая оплата от арендатора!</b>\n\n` +
      `Арендатор: ${data.userName}\n` +
      `Квартира: ${data.apartmentAddress}\n` +
      `Сумма: ${data.amount}\n` +
      `Ожидает подтверждения.`;

    const extra = Markup.inlineKeyboard([
      Markup.button.callback('✅ Подтвердить', `confirm_payment_${data.paymentId}`),
      Markup.button.callback('❌ Отклонить', `reject_payment_${data.paymentId}`)
    ]);

    await this.notifyAdmins(message, 'payment_created', extra, data.receiptPhotoId);
  }

  @EventPattern('tenant_registered')
  async handleTenantRegistered(@Payload() data: { 
    tenantId: number; 
    name: string; 
    phone: string;
  }) {
    const message = `👤 <b>Новый запрос на регистрацию!</b>\n\n` +
      `Имя: ${data.name}\n` +
      `Телефон: ${data.phone}\n` +
      `Ожидает подтверждения и привязки к квартире.`;

    const extra = Markup.inlineKeyboard([
      Markup.button.callback('✅ Подтвердить', `admin_link_tenant_${data.tenantId}`),
      Markup.button.callback('❌ Отклонить', `admin_reject_tenant_${data.tenantId}`)
    ]);

    await this.notifyAdmins(message, 'tenant_registered', extra);
  }

  @EventPattern('tenant_activated')
  async handleTenantActivated(@Payload() data: { 
    tenantId?: number;
    chatId: string; 
    apartmentAddress?: string;
    rentPaymentDay?: number;
    rentAmount?: string;
  }) {
    let message = `✅ <b>Ваша регистрация подтверждена!</b>\n\n`;
    if (data.apartmentAddress) {
      message += `Администратор привязал вашу учетную запись к квартире: ${data.apartmentAddress}.\n`;
    }
    if (data.rentPaymentDay && data.rentAmount) {
      message += `📅 Дата оплаты: ${data.rentPaymentDay} число каждого месяца.\n`;
      message += `💰 Сумма к оплате: ${data.rentAmount}\n`;
    }
    message += `\nТеперь вы можете добавлять оплаты и просматривать квитанции.`;

    if (data.tenantId) {
      try {
        await this.prisma.user.upsert({
          where: { telegramId: BigInt(data.chatId) },
          create: {
            telegramId: BigInt(data.chatId),
            tenantId: data.tenantId,
            role: 'tenant'
          },
          update: {
            tenantId: data.tenantId
          }
        });
      } catch (e: any) {
        this.logger.error(`Failed to link tenantId ${data.tenantId} to user ${data.chatId}: ${e.message}`);
      }
    }

    this.logger.log(`Sending activation notification to tenant chatId ${data.chatId}`);
    await this.botService.sendNotification(message, data.chatId);
    this.logger.log(`Activation notification sent to tenant chatId ${data.chatId}`);
  }

  @EventPattern('remind_rent_payment')
  async handleRentReminder(@Payload() data: { 
    chatId: string; 
    rentAmount: string; 
    apartmentAddress: string;
  }) {
    const message = `🔔 <b>Напоминание об оплате аренды!</b>\n\n` +
      `Квартира: ${data.apartmentAddress}\n` +
      `Сумма к оплате: ${data.rentAmount}\n\n` +
      `Пожалуйста, не забудьте произвести оплату и отправить чек через бота (кнопка "Добавить оплату").`;

    this.logger.log(`Sending rent reminder notification to tenant chatId ${data.chatId}`);
    await this.botService.sendNotification(message, data.chatId);
    this.logger.log(`Rent reminder notification sent to tenant chatId ${data.chatId}`);
  }

  /**
   * Метод только для публикации нового начисления (без файла инвойса).
   */
  @EventPattern('accrual_upserted')
  async handleAccrualUpserted(@Payload() data: { 
    periodLabel: string; 
    amountText: string; 
    statusText: string; 
    rawJson?: string;
    apartment?: { id: number; address?: string };
    tenant?: { id: number; status: string };
  }) {
    const targetChatIds = new Set<string>();
    const apartmentAddress = data.apartment?.address || 'неизвестен';

    // 1. Resolve personal chat if tenant is active
    if (data.tenant && data.tenant.status === 'active') {
      try {
        const user = await this.prisma.user.findUnique({
          where: { tenantId: data.tenant.id }
        });
        if (user) {
          targetChatIds.add(user.telegramId.toString());
        }
      } catch (e: any) {
        this.logger.error(`Failed to lookup user by tenantId ${data.tenant.id}: ${e.message}`);
      }
    }

    // 2. Resolve feed channels
    try {
      let feedChannels = await this.prisma.publicationChannel.findMany({
        where: { type: 'feed' }
      });

      // Fallback/sync with config.TELEGRAM_CHAT_ID
      if (feedChannels.length === 0 && config.TELEGRAM_CHAT_ID) {
        const defaultFeed = await this.prisma.publicationChannel.upsert({
          where: { chatId: config.TELEGRAM_CHAT_ID },
          create: { chatId: config.TELEGRAM_CHAT_ID, name: 'Default Feed', type: 'feed' },
          update: { type: 'feed' }
        });
        feedChannels = [defaultFeed];
      }

      for (const channel of feedChannels) {
        targetChatIds.add(channel.chatId);
      }
    } catch (e: any) {
      this.logger.error(`Failed to resolve feed channels: ${e.message}`);
    }

    if (targetChatIds.size === 0) return;

    let amount = data.amountText || 'Не указана';
    let status = data.statusText || 'Неизвестен';
    try {
      const raw = JSON.parse(data.rawJson || '{}');
      const acc = raw.accrual || {};
      const btn = acc.button || {};

      const val = (acc.accruedAmount !== undefined && Number(acc.accruedAmount) !== 0) ? Number(acc.accruedAmount) :
                  (acc.amountToPay !== undefined && Number(acc.amountToPay) !== 0) ? Number(acc.amountToPay) :
                  (acc.paidAmount !== undefined ? Number(acc.paidAmount) : 0);
      amount = `${val.toFixed(2)} руб.`;

      if (btn.pay === true && Number(btn.toPay) > 0) {
        status = 'Ожидает оплаты';
      } else if (acc.amountToPay === 0 || Number(btn.toPay) === 0) {
        status = 'Оплачено';
      } else if (btn.message) {
        status = btn.message;
      }
    } catch (e) {
      // fallback
    }

    const message = `🔔 <b>Новое начисление!</b>\n\n` +
      `Период: ${data.periodLabel}\n` +
      `Сумма: ${amount}\n` +
      `Статус: ${status}\n` +
      `Адрес: ${apartmentAddress}`;

    for (const chatId of targetChatIds) {
      try {
        this.logger.log(`Sending accrual notification (period: ${data.periodLabel}) to chat ${chatId}`);
        await this.botService.sendNotification(message, chatId);
        this.logger.log(`Accrual notification (period: ${data.periodLabel}) sent to chat ${chatId}`);
      } catch (err: any) {
        this.logger.error(`Failed to send accrual notification to chat ${chatId}: ${err.message}`);
      }
    }
  }

  /**
   * Метод для публикации нового инвойса (с файлом инвойса/квитанцией из S3).
   */
  @EventPattern('invoice_available')
  async handleInvoiceAvailable(@Payload() data: { 
    id: number;
    periodLabel: string; 
    apartment?: { id: number; address?: string };
    tenant?: { id: number; status: string };
  }) {
    const targetChatIds = new Set<string>();
    const apartmentAddress = data.apartment?.address || 'неизвестен';

    // 1. Resolve personal chat if tenant is active
    if (data.tenant && data.tenant.status === 'active') {
      try {
        const user = await this.prisma.user.findUnique({
          where: { tenantId: data.tenant.id }
        });
        if (user) {
          targetChatIds.add(user.telegramId.toString());
        }
      } catch (e: any) {
        this.logger.error(`Failed to lookup user by tenantId ${data.tenant.id}: ${e.message}`);
      }
    }

    // 2. Resolve feed channels
    try {
      let feedChannels = await this.prisma.publicationChannel.findMany({
        where: { type: 'feed' }
      });

      // Fallback/sync with config.TELEGRAM_CHAT_ID
      if (feedChannels.length === 0 && config.TELEGRAM_CHAT_ID) {
        const defaultFeed = await this.prisma.publicationChannel.upsert({
          where: { chatId: config.TELEGRAM_CHAT_ID },
          create: { chatId: config.TELEGRAM_CHAT_ID, name: 'Default Feed', type: 'feed' },
          update: { type: 'feed' }
        });
        feedChannels = [defaultFeed];
      }

      for (const channel of feedChannels) {
        targetChatIds.add(channel.chatId);
      }
    } catch (e: any) {
      this.logger.error(`Failed to resolve feed channels: ${e.message}`);
    }

    if (targetChatIds.size === 0) return;

    // Fetch invoice details from Accountant service to check if downloadUrl is available
    let downloadUrl: string | null = null;
    try {
      const invoiceData = await firstValueFrom(
        this.accountantClient.send<any>('get_invoice', data.id)
      );
      if (invoiceData && invoiceData.downloadUrl) {
        downloadUrl = invoiceData.downloadUrl;
      }
    } catch (e: any) {
      this.logger.error(`Failed to fetch details for invoice ${data.id}: ${e.message}`);
    }

    const dateStr = new Date().toLocaleDateString('ru-RU', { timeZone: config.TZ });
    const message = `📅 ${dateStr}\n` +
      `📄 <b>Доступна новая квитанция!</b>\n\n` +
      `Период: ${data.periodLabel}\n` +
      `Адрес: ${apartmentAddress}`;

    for (const chatId of targetChatIds) {
      try {
        // Resolve or create channel in DB to link with Publication
        const channel = await this.prisma.publicationChannel.upsert({
          where: { chatId },
          create: { 
            chatId, 
            type: chatId === config.TELEGRAM_CHAT_ID ? 'feed' : 'personal',
            name: chatId === config.TELEGRAM_CHAT_ID ? 'Default Feed' : 'Personal Chat'
          },
          update: {}
        });

        const existingPublication = await this.prisma.publication.findUnique({
          where: {
            invoiceId_channelId: {
              invoiceId: data.id,
              channelId: channel.id
            }
          }
        });

        if (existingPublication) {
          this.logger.log(`Invoice ${data.id} already sent to chat ${chatId}. Skipping.`);
          continue;
        }

        this.logger.log(`Sending invoice available notification (invoiceId: ${data.id}, period: ${data.periodLabel}) to chat ${chatId}`);
        if (downloadUrl) {
          const filename = `Квитанция_${data.periodLabel}.pdf`;
          await this.botService.sendInvoiceDocument(chatId, downloadUrl, filename, message);
        } else {
          await this.botService.sendNotification(message, chatId);
        }

        await this.prisma.publication.create({
          data: {
            invoiceId: data.id,
            channelId: channel.id
          }
        });
        this.logger.log(`Notification for invoice ${data.id} sent to chat ${chatId} and logged.`);
      } catch (err: any) {
        this.logger.error(`Failed to process invoice notification/log for chat ${chatId}: ${err.message}`);
      }
    }
  }

  @MessagePattern('meter_submission_required')
  async handleMeterSubmissionRequired(@Payload() data: {
    eventId: number;
    accountExternalId: string;
    accountLabel: string;
    apartmentAddress: string;
    periodLabel: string;
  }) {
    this.logger.log(`Received meter_submission_required for event ${data.eventId}`);
    const message = formatMeterSubmissionMessage({
      periodLabel: data.periodLabel,
      apartmentAddress: data.apartmentAddress,
      accountLabel: data.accountLabel,
      status: 'PENDING',
      readingsValue: null
    });

    const extra = getMeterSubmissionButtons({
      id: data.eventId,
      status: 'PENDING'
    });

    const success = await this.notifyAdmins(message, 'meter_submission_required', extra);
    return { success };
  }

  @MessagePattern('meter_submission_reminder')
  async handleMeterSubmissionReminder(@Payload() data: {
    eventId: number;
    accountExternalId: string;
    accountLabel: string;
    apartmentAddress: string;
    periodLabel: string;
  }) {
    this.logger.log(`Received meter_submission_reminder for event ${data.eventId}`);
    const message = formatMeterSubmissionMessage({
      periodLabel: data.periodLabel,
      apartmentAddress: data.apartmentAddress,
      accountLabel: data.accountLabel,
      status: 'PENDING',
      readingsValue: null
    });

    const extra = getMeterSubmissionButtons({
      id: data.eventId,
      status: 'PENDING'
    });

    const success = await this.notifyAdmins(message, 'meter_submission_reminder', extra);
    return { success };
  }

  @EventPattern('scan_completed')
  async handleScanCompleted(@Payload() data: {
    startedAt: string;
    finishedAt: string;
    trigger: 'manual' | 'cron';
    status: 'success' | 'warning' | 'needs_login' | 'error';
    message: string;
    apartmentsScanned: number;
    accrualsObserved: number;
    invoicesObserved: number;
    newApartments: number;
    newAccruals: number;
    newInvoices: number;
    needsLogin: boolean;
  }) {
    const started = new Date(data.startedAt);
    const finished = new Date(data.finishedAt);
    const durationSeconds = Math.max(0, Math.round((finished.getTime() - started.getTime()) / 1000));

    const statusEmojis = {
      success: '✅',
      warning: '⚠️',
      needs_login: '🔑',
      error: '❌',
    };
    const statusTexts = {
      success: 'Успешно',
      warning: 'Предупреждение',
      needs_login: 'Требуется авторизация',
      error: 'Ошибка',
    };

    const triggerTexts = {
      manual: 'Вручную',
      cron: 'По расписанию',
    };

    const statusEmoji = statusEmojis[data.status] || '❓';
    const statusText = statusTexts[data.status] || data.status;
    const triggerText = triggerTexts[data.trigger] || data.trigger;

    let message = `🔍 <b>Результаты сканирования</b>\n\n` +
      `📊 <b>Статус:</b> ${statusEmoji} ${statusText}\n` +
      `🚀 <b>Триггер:</b> ${triggerText}\n` +
      `⏱ <b>Длительность:</b> ${durationSeconds} сек.\n\n` +
      `🏢 <b>Квартиры:</b> ${data.apartmentsScanned} (новых: ${data.newApartments})\n` +
      `💵 <b>Начисления:</b> ${data.accrualsObserved} (новых: ${data.newAccruals})\n` +
      `📄 <b>Квитанции:</b> ${data.invoicesObserved} (новых: ${data.newInvoices})\n`;

    if (data.message) {
      message += `\n💬 <b>Сообщение:</b> ${data.message}`;
    }

    await this.notifyAdmins(message, `scan_completed (status: ${data.status})`);
  }

  @EventPattern('scheduled_event_triggered')
  async handleScheduledEventTriggered(@Payload() data: {
    eventId: number;
    title: string;
    description?: string;
    targetType: string;
    frequency?: string;
    dayOfMonth?: number;
    telegramTemplate?: string;
  }) {
    this.logger.log(`Received scheduled_event_triggered for event #${data.eventId}: ${data.title}`);

    const freqText = data.frequency === 'quarterly' ? 'Каждые 3 месяца' : 'Каждый месяц';
    const dayText = data.dayOfMonth ? `${data.dayOfMonth}-го числа` : '';

    let message = '';
    if (data.telegramTemplate && data.telegramTemplate.trim()) {
      message = data.telegramTemplate
        .replace(/\{title\}/g, data.title || '')
        .replace(/\{description\}/g, data.description || '')
        .replace(/\{frequency\}/g, freqText)
        .replace(/\{dayOfMonth\}/g, dayText)
        .replace(/\{targetType\}/g, data.targetType || '');
    } else {
      message = `📅 <b>Запланированное событие!</b>\n\n` +
        `📌 <b>${data.title}</b>\n` +
        `${data.description ? `📝 ${data.description}\n` : ''}` +
        `🔄 Периодичность: ${freqText} ${dayText}\n` +
        `🎯 Объект: ${data.targetType}\n\n` +
        `⚡ Пожалуйста, проверьте статус события в панели управления!`;
    }

    await this.notifyAdmins(message, `scheduled_event_triggered (#${data.eventId})`);
  }

  private async notifyAdmins(
    message: string,
    actionName: string,
    extra?: any,
    receiptPhotoId?: string | null
  ): Promise<boolean> {
    try {
      const admins = await this.prisma.user.findMany({ where: { role: 'admin' } });
      const targetChatIds = new Set<string>();
      for (const admin of admins) {
        targetChatIds.add(admin.telegramId.toString());
      }
      if (config.SUPER_ADMIN_TELEGRAM_ID) {
        targetChatIds.add(config.SUPER_ADMIN_TELEGRAM_ID);
      }

      this.logger.log(`Notifying ${targetChatIds.size} admins about: ${actionName}`);

      let sentCount = 0;
      for (const chatId of targetChatIds) {
        try {
          if (receiptPhotoId) {
            await this.botService.sendAdminPhotoNotification(receiptPhotoId, message, chatId, extra);
          } else {
            await this.botService.sendAdminNotification(message, chatId, extra);
          }
          sentCount++;
        } catch (err: any) {
          this.logger.error(`Failed to send ${actionName} notification to admin ${chatId}: ${err.message}`);
        }
      }
      return sentCount > 0;
    } catch (e: any) {
      this.logger.error(`Failed to execute notifyAdmins for ${actionName}: ${e.message}`);
      return false;
    }
  }
}

export function formatMeterSubmissionMessage(data: {
  periodLabel: string;
  apartmentAddress: string;
  accountLabel: string;
  status?: string;
  readingsValue?: string | null;
}) {
  let statusText = '⏳ Ожидает получения от арендатора';
  if (data.status === 'COMPLETED_WITHOUT_SUBMISSION') {
    statusText = '❌ Завершено без передачи';
  } else if (data.status === 'SUBMITTED') {
    statusText = '✅ Переданы в службу';
  } else if (data.status === 'RECEIVED') {
    statusText = '📩 Получены от арендатора (ожидают отправки)';
  }

  const readingsText = data.readingsValue ? `<code>${data.readingsValue}</code>` : '<i>(не введены)</i>';

  return `🔔 <b>Подача показаний счетчиков</b>\n\n` +
    `🏠 <b>Адрес:</b> ${data.apartmentAddress}\n` +
    `🧾 <b>Счет:</b> ${data.accountLabel}\n` +
    `📅 <b>Период:</b> ${data.periodLabel}\n` +
    `📊 <b>Статус:</b> ${statusText}\n` +
    `📝 <b>Показания:</b> ${readingsText}\n\n` +
    `Пожалуйста, выполните необходимые действия ниже.`;
}

export function getMeterSubmissionButtons(event: {
  id: number;
  status?: string;
}) {
  if (event.status === 'SUBMITTED' || event.status === 'COMPLETED_WITHOUT_SUBMISSION') {
    return Markup.inlineKeyboard([]); // Нет кнопок для финальных статусов
  }

  if (event.status === 'RECEIVED') {
    return Markup.inlineKeyboard([
      [Markup.button.callback('📤 Отметить как переданные', `admin_submit_readings_${event.id}`)],
      [Markup.button.callback('📝 Изменить показания', `admin_enter_readings_${event.id}`)],
      [Markup.button.callback('❌ Завершить без передачи', `admin_complete_without_sub_${event.id}`)]
    ]);
  }

  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Получены', `admin_confirm_readings_received_${event.id}`),
      Markup.button.callback('📥 Ввести показания', `admin_enter_readings_${event.id}`)
    ],
    [Markup.button.callback('❌ Завершить без передачи', `admin_complete_without_sub_${event.id}`)]
  ]);
}
