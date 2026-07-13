import { Controller, Inject, Logger } from '@nestjs/common';
import { EventPattern, Payload, ClientProxy } from '@nestjs/microservices';
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

  @EventPattern('accrual_upserted')
  async handleAccrualUpserted(@Payload() data: { 
    periodLabel: string; 
    amountText: string; 
    statusText: string; 
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

    const message = `🔔 <b>Новое начисление!</b>\n\n` +
      `Период: ${data.periodLabel}\n` +
      `Сумма: ${data.amountText}\n` +
      `Статус: ${data.statusText}\n` +
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

  private async notifyAdmins(
    message: string,
    actionName: string,
    extra?: any,
    receiptPhotoId?: string | null
  ) {
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

      for (const chatId of targetChatIds) {
        try {
          if (receiptPhotoId) {
            await this.botService.sendAdminPhotoNotification(receiptPhotoId, message, chatId, extra);
          } else {
            await this.botService.sendAdminNotification(message, chatId, extra);
          }
        } catch (err: any) {
          this.logger.error(`Failed to send ${actionName} notification to admin ${chatId}: ${err.message}`);
        }
      }
    } catch (e: any) {
      this.logger.error(`Failed to execute notifyAdmins for ${actionName}: ${e.message}`);
    }
  }
}
