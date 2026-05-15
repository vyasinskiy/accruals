import { Controller, Inject, Logger } from '@nestjs/common';
import { EventPattern, Payload, ClientProxy } from '@nestjs/microservices';
import { TelegramBotNotificationService } from './telegram-bot-notification.service';
import { Markup } from 'telegraf';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../common/prisma/prisma.service';

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
          if (user && user.identities) {
            const tgIdentity = user.identities.find((i: any) => i.platform === 'telegram');
            if (tgIdentity) {
              targetChatId = tgIdentity.externalId;
            }
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
          if (user && user.identities) {
            const tgIdentity = user.identities.find((i: any) => i.platform === 'telegram');
            if (tgIdentity) {
              targetChatId = tgIdentity.externalId;
            }
          }
        }
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      this.logger.error(`Failed to fetch info for invoice notification: ${errorMessage}`);
    }

    if (!targetChatId) return;

    const message = `📄 <b>Доступна новая квитанция!</b>\n\n` +
      `Период: ${data.periodLabel}\n` +
      `Адрес: ${apartmentAddress}`;

    await this.botService.sendNotification(message, targetChatId);
  }
}
