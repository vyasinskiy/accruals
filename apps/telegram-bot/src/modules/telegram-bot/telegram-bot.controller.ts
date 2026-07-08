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

    const admins = await this.prisma.user.findMany({ where: { role: 'admin' } });
    for (const admin of admins) {
      await this.botService.sendAdminPhotoNotification(data.receiptPhotoId, message, admin.telegramId.toString(), extra);
    }
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

    const admins = await this.prisma.user.findMany({ where: { role: 'admin' } });
    for (const admin of admins) {
      await this.botService.sendAdminNotification(message, admin.telegramId.toString(), extra);
    }
  }

  @EventPattern('tenant_activated')
  async handleTenantActivated(@Payload() data: { 
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

    await this.botService.sendNotification(message, data.chatId);
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

    await this.botService.sendNotification(message, data.chatId);
  }

  @EventPattern('accrual_upserted')
  async handleAccrualUpserted(@Payload() data: { 
    periodLabel: string; 
    amountText: string; 
    statusText: string; 
    apartmentId: number;
    chatId?: string;
  }) {
    let targetChatId = data.chatId;
    let apartmentAddress = 'неизвестен';

    try {
      const apartment = await firstValueFrom(this.accountantClient.send('get_apartment', data.apartmentId));
      if (apartment) {
        apartmentAddress = apartment.address || apartment.externalId;
        
        if (!targetChatId) {
          const user = await firstValueFrom(this.accountantClient.send('get_tenant_by_apartment', data.apartmentId));
          if (user && user.telegramId) {
            targetChatId = user.telegramId.toString();
          }
        }
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      this.logger.error(`Failed to fetch info for accrual notification: ${errorMessage}`);
    }

    if (!targetChatId) return;

    const message = `🔔 <b>Новое начисление!</b>\n\n` +
      `Период: ${data.periodLabel}\n` +
      `Сумма: ${data.amountText}\n` +
      `Статус: ${data.statusText}\n` +
      `Адрес: ${apartmentAddress}`;

    await this.botService.sendNotification(message, targetChatId);
  }

  @EventPattern('invoice_available')
  async handleInvoiceAvailable(@Payload() data: { 
    id: number;
    periodLabel: string; 
    apartmentId: number;
    chatId?: string;
  }) {
    let targetChatId = data.chatId;
    let apartmentAddress = 'неизвестен';

    try {
      const apartment = await firstValueFrom(this.accountantClient.send('get_apartment', data.apartmentId));
      if (apartment) {
        apartmentAddress = apartment.address || apartment.externalId;
        
        if (!targetChatId) {
          const user = await firstValueFrom(this.accountantClient.send('get_tenant_by_apartment', data.apartmentId));
          if (user && user.telegramId) {
            targetChatId = user.telegramId.toString();
          }
        }
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      this.logger.error(`Failed to fetch info for invoice notification: ${errorMessage}`);
    }

    if (!targetChatId) return;

    try {
      const existingPublication = await this.prisma.publication.findFirst({
        where: {
          invoiceId: data.id,
          channel: {
            chatId: targetChatId
          }
        }
      });
      if (existingPublication) {
        this.logger.log(`Invoice ${data.id} already sent to chat ${targetChatId}. Skipping notification.`);
        return;
      }
    } catch (e: any) {
      this.logger.error(`Failed to check invoice publication status: ${e.message}`);
    }

    const message = `📄 <b>Доступна новая квитанция!</b>\n\n` +
      `Период: ${data.periodLabel}\n` +
      `Адрес: ${apartmentAddress}`;

    try {
      await this.botService.sendNotification(message, targetChatId);
      await this.prisma.publication.create({
        data: {
          invoiceId: data.id,
          channel: {
            connectOrCreate: {
              where: { chatId: targetChatId },
              create: { chatId: targetChatId }
            }
          }
        }
      });
      this.logger.log(`Notification for invoice ${data.id} sent to chat ${targetChatId} and logged.`);
    } catch (err: any) {
      this.logger.error(`Failed to send invoice notification to Telegram: ${err.message}`);
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

    try {
      const admins = await this.prisma.user.findMany({ where: { role: 'admin' } });
      const targetChatIds = new Set<string>();
      for (const admin of admins) {
        targetChatIds.add(admin.telegramId.toString());
      }
      if (config.SUPER_ADMIN_TELEGRAM_ID) {
        targetChatIds.add(config.SUPER_ADMIN_TELEGRAM_ID);
      }

      for (const chatId of targetChatIds) {
        try {
          await this.botService.sendAdminNotification(message, chatId);
        } catch (err: any) {
          this.logger.error(`Failed to send scan notification to ${chatId}: ${err.message}`);
        }
      }
    } catch (e: any) {
      this.logger.error(`Failed to retrieve admins for scan completed notification: ${e.message}`);
    }
  }
}
