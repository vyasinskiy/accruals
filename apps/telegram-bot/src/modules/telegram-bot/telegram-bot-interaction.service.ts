import { Injectable, OnModuleInit, Inject, Logger } from '@nestjs/common';
import { Telegraf, Context, Markup, session } from 'telegraf';
import { ClientProxy } from '@nestjs/microservices';
import { config } from '../../common/config/config';
import { firstValueFrom } from 'rxjs';
import { AdminInteractionService } from '../admin/admin-interaction.service';
import { PrismaService } from '../../common/prisma/prisma.service';

interface MyContext extends Context {
  session: {
    state?: 'awaiting_registration_name' | 'awaiting_registration_phone' | 'awaiting_amount' | 'awaiting_photo' | 'awaiting_admin_rent_day' | 'awaiting_admin_rent_amount' | 'admin_editing_rent_day' | 'admin_editing_rent_amount';
    amount?: number;
    paymentTargetTelegramId?: string;
    editTenantId?: number;
    editApartmentId?: number;
    regData?: {
      name?: string;
    };
    adminLinkData?: {
      tenantId?: number;
      apartmentId?: number;
      rentPaymentDay?: number;
    };
  };
}

@Injectable()
export class TelegramBotInteractionService implements OnModuleInit {
  private readonly logger = new Logger(TelegramBotInteractionService.name);
  private bot: Telegraf<MyContext>;

  constructor(
    @Inject('ACCOUNTANT_SERVICE') private readonly accountantClient: ClientProxy,
    private readonly adminInteractionService: AdminInteractionService,
    private readonly prisma: PrismaService
  ) {}

  onModuleInit() {
    this.bot = new Telegraf<MyContext>(config.TELEGRAM_BOT_TOKEN);
    this.bot.use(session());
    this.setupHandlers();
    this.adminInteractionService.registerHandlers(this.bot);
    this.bot.launch().then(() => {
      this.logger.log('Telegram bot launched');
    }).catch(err => {
      this.logger.error('Failed to launch Telegram bot', err);
    });
  }

  private setupHandlers() {
    this.bot.start(async (ctx) => {
      try {
        // Sync user with local DB
        const localUser = await this.prisma.user.upsert({
          where: { telegramId: BigInt(ctx.from.id) },
          create: {
            telegramId: BigInt(ctx.from.id),
            username: ctx.from.username,
            firstName: ctx.from.first_name,
            lastName: ctx.from.last_name,
            role: ctx.from.id.toString() === config.SUPER_ADMIN_TELEGRAM_ID ? 'admin' : 'tenant'
          },
          update: {
            username: ctx.from.username,
            firstName: ctx.from.first_name,
            lastName: ctx.from.last_name,
            role: ctx.from.id.toString() === config.SUPER_ADMIN_TELEGRAM_ID ? 'admin' : 'tenant'
          }
        });

        const user = await firstValueFrom(this.accountantClient.send('get_tenant', { telegramId: ctx.from.id }));

        if (localUser.role === 'admin') {
          return ctx.reply('Здравствуйте, администратор! Я бот для учета начислений.', Markup.keyboard([
            ['Добавить оплату', 'Админ Меню'],
            ['Управление пользователями']
          ]).resize());
        }

        if (!user || !user.tenantProfile) {
          ctx.session = ctx.session || {};
          ctx.session.state = 'awaiting_registration_name';
          ctx.session.regData = {};
          return ctx.reply('Здравствуйте! Для использования бота необходимо зарегистрироваться.\n\nПожалуйста, введите ваше Имя и Фамилию:', Markup.removeKeyboard());
        }

        if (user.tenantProfile.status === 'pending') {
          return ctx.reply('Ваша заявка на регистрацию отправлена администратору. Пожалуйста, ожидайте подтверждения и привязки к квартире.', Markup.removeKeyboard());
        }

        if (user.tenantProfile.status === 'rejected') {
          return ctx.reply('Ваша заявка на регистрацию отклонена администратором.', Markup.removeKeyboard());
        }

        // Active status
        ctx.reply('Привет! Я бот для учета начислений.', Markup.keyboard([
          ['Добавить оплату']
        ]).resize());
      } catch (e) {
        this.logger.error('Failed to get tenant on /start', e);
        ctx.reply('Произошла ошибка при получении данных профиля. Попробуйте позже.');
      }
    });

    this.bot.hears('Добавить оплату', async (ctx) => {
      try {
        const user = await firstValueFrom(this.accountantClient.send('get_tenant', { telegramId: ctx.from.id }));
        if (!user || (user.role !== 'admin' && (!user.tenantProfile || user.tenantProfile.status !== 'active'))) {
          return ctx.reply('У вас нет активной привязки к квартире. Ожидайте подтверждения администратора.');
        }

        ctx.session = ctx.session || {};

        if (user.role === 'admin') {
          const apartments = await firstValueFrom(this.accountantClient.send('get_apartments', {}));
          if (!apartments || apartments.length === 0) {
            return ctx.reply('Нет доступных квартир для добавления оплаты.');
          }
          const buttons = apartments.map((apt: any) => [Markup.button.callback(apt.address || apt.externalId, `admin_pay_apt_${apt.id}`)]);
          return ctx.reply('Выберите квартиру для добавления оплаты:', Markup.inlineKeyboard(buttons));
        }

        ctx.session.state = 'awaiting_amount';
        ctx.session.paymentTargetTelegramId = ctx.from.id.toString();
        ctx.reply('Введите сумму оплаты (только число):');
      } catch (e) {
        ctx.reply('Произошла ошибка. Попробуйте позже.');
      }
    });

    this.bot.action(/admin_pay_apt_(\d+)/, async (ctx) => {
      const apartmentId = parseInt(ctx.match[1]);
      try {
        const tenant = await firstValueFrom(this.accountantClient.send('get_tenant_by_apartment', apartmentId));
        if (!tenant) {
          return ctx.answerCbQuery('В этой квартире нет активного арендатора.', { show_alert: true });
        }
        
        const tgIdentity = tenant.identities?.find((i: any) => i.platform === 'telegram');
        if (!tgIdentity) {
           return ctx.answerCbQuery('У арендатора нет Telegram.', { show_alert: true });
        }

        ctx.session = ctx.session || {};
        ctx.session.state = 'awaiting_amount';
        ctx.session.paymentTargetTelegramId = tgIdentity.externalId;
        
        await ctx.answerCbQuery();
        await ctx.editMessageText(`Выбрана квартира. Арендатор: ${tenant.name || 'Неизвестно'}\nВведите сумму оплаты (только число):`, Markup.inlineKeyboard([]));
      } catch (e) {
        this.logger.error('Failed to prepare admin payment', e);
        await ctx.answerCbQuery('Ошибка сервера.');
      }
    });

    this.bot.on('text', async (ctx, next) => {
      if (ctx.session?.state === 'awaiting_registration_name') {
        ctx.session.regData = { name: ctx.message.text };
        ctx.session.state = 'awaiting_registration_phone';
        return ctx.reply('Спасибо. Теперь введите ваш номер телефона (или другой контакт для связи):');
      }

      if (ctx.session?.state === 'awaiting_registration_phone') {
        const phone = ctx.message.text;
        const name = ctx.session.regData?.name || ctx.from.first_name;

        ctx.session.state = undefined;
        ctx.session.regData = undefined;

        try {
          await firstValueFrom(this.accountantClient.send('create_tenant', {
            telegramId: ctx.from.id,
            name: name,
            phone: phone
          }));
          return ctx.reply('Спасибо! Ваша заявка отправлена администратору. Ожидайте подтверждения.');
        } catch (e) {
          this.logger.error('Failed to register tenant', e);
          return ctx.reply('Произошла ошибка при регистрации. Попробуйте позже.');
        }
      }

      if (ctx.session?.state === 'awaiting_amount') {
        const amount = parseFloat(ctx.message.text.replace(',', '.'));
        if (isNaN(amount)) {
          return ctx.reply('Пожалуйста, введите корректное число.');
        }
        ctx.session.amount = amount;
        ctx.session.state = 'awaiting_photo';
        return ctx.reply('Пришлите фотографию чека/подтверждения:', Markup.inlineKeyboard([
          Markup.button.callback('Нет чека', 'skip_receipt_photo')
        ]));
      }

      if (ctx.session?.state === 'awaiting_admin_rent_day') {
        const day = parseInt(ctx.message.text);
        if (isNaN(day) || day < 1 || day > 31) {
          return ctx.reply('Пожалуйста, введите корректный день месяца (от 1 до 31).');
        }
        if (!ctx.session.adminLinkData) ctx.session.adminLinkData = {};
        ctx.session.adminLinkData.rentPaymentDay = day;
        ctx.session.state = 'awaiting_admin_rent_amount';
        return ctx.reply(`День оплаты: ${day}. Теперь введите сумму ежемесячной аренды (только число):`);
      }

      if (ctx.session?.state === 'awaiting_admin_rent_amount') {
        const amount = parseFloat(ctx.message.text.replace(',', '.'));
        if (isNaN(amount) || amount <= 0) {
          return ctx.reply('Пожалуйста, введите корректную сумму (больше 0).');
        }
        
        const linkData = ctx.session.adminLinkData;
        if (!linkData || !linkData.tenantId || !linkData.apartmentId || !linkData.rentPaymentDay) {
          ctx.session.state = undefined;
          return ctx.reply('Ошибка сессии. Пожалуйста, начните привязку заново.');
        }

        try {
          await firstValueFrom(this.accountantClient.send('link_tenant_apartment', { 
            tenantId: linkData.tenantId, 
            apartmentId: linkData.apartmentId,
            rentPaymentDay: linkData.rentPaymentDay,
            rentAmount: amount
          }));
          
          ctx.session.state = undefined;
          ctx.session.adminLinkData = undefined;
          
          return ctx.reply(`✅ Арендатор успешно привязан к квартире. Дата оплаты: ${linkData.rentPaymentDay}, Сумма: ${amount}`);
        } catch (e) {
          this.logger.error('Failed to link tenant', e);
          return ctx.reply('Ошибка при привязке арендатора.');
        }
      }

      if (ctx.session?.state === 'admin_editing_rent_day') {
        const day = parseInt(ctx.message.text);
        if (isNaN(day) || day < 1 || day > 31) {
          return ctx.reply('Пожалуйста, введите корректный день месяца (от 1 до 31).');
        }
        try {
          await firstValueFrom(this.accountantClient.send('update_tenant_payment_settings', { 
            tenantId: ctx.session.editTenantId, 
            rentPaymentDay: day 
          }));
          const aptId = ctx.session.editApartmentId;
          ctx.session.state = undefined;
          ctx.session.editTenantId = undefined;
          ctx.session.editApartmentId = undefined;
          
          await ctx.reply(`✅ День оплаты успешно изменен на ${day}.`);
          if (aptId) {
            await this.adminInteractionService.showApartmentMenu(ctx, aptId);
          }
          return;
        } catch (e) {
          this.logger.error('Failed to update rent day', e);
          return ctx.reply('Ошибка при обновлении дня оплаты.');
        }
      }

      if (ctx.session?.state === 'admin_editing_rent_amount') {
        const amount = parseFloat(ctx.message.text.replace(',', '.'));
        if (isNaN(amount) || amount <= 0) {
          return ctx.reply('Пожалуйста, введите корректную сумму (больше 0).');
        }
        try {
          await firstValueFrom(this.accountantClient.send('update_tenant_payment_settings', { 
            tenantId: ctx.session.editTenantId, 
            rentAmount: amount 
          }));
          const aptId = ctx.session.editApartmentId;
          ctx.session.state = undefined;
          ctx.session.editTenantId = undefined;
          ctx.session.editApartmentId = undefined;
          
          await ctx.reply(`✅ Сумма аренды успешно изменена на ${amount}.`);
          if (aptId) {
            await this.adminInteractionService.showApartmentMenu(ctx, aptId);
          }
          return;
        } catch (e) {
          this.logger.error('Failed to update rent amount', e);
          return ctx.reply('Ошибка при обновлении суммы аренды.');
        }
      }

      return next();
    });

    this.bot.on('photo', async (ctx) => {
      if (ctx.session?.state === 'awaiting_photo') {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const amount = ctx.session.amount;
        
        this.logger.log(`User ${ctx.from.id} submitted payment for amount ${amount}`);

        // Save to DB via accountant
        try {
          const payment = await firstValueFrom(this.accountantClient.send('create_payment', {
            telegramId: ctx.from.id,
            userName: ctx.from.username || ctx.from.first_name,
            amount,
            receiptPhotoId: photo.file_id
          }));

          ctx.session.state = undefined;
          ctx.session.amount = undefined;

          await ctx.reply('Оплата добавлена и отправлена на подтверждение админу.');
        } catch (error) {
          const message = error instanceof Error ? error.message : (typeof error === 'object' ? JSON.stringify(error) : String(error));
          this.logger.error(`Failed to create payment: ${message}`);
          await ctx.reply('Произошла ошибка при сохранении данных. Попробуйте позже.');
        }
      }
    });

    this.bot.action('skip_receipt_photo', async (ctx) => {
      if (ctx.session?.state === 'awaiting_photo') {
        const amount = ctx.session.amount;
        const targetTelegramId = ctx.session.paymentTargetTelegramId || ctx.from.id;
        
        this.logger.log(`User ${ctx.from.id} submitted payment without photo for amount ${amount} (Target: ${targetTelegramId})`);

        try {
          await firstValueFrom(this.accountantClient.send('create_payment', {
            telegramId: targetTelegramId,
            userName: ctx.from.username || ctx.from.first_name,
            amount,
            receiptPhotoId: null
          }));

          ctx.session.state = undefined;
          ctx.session.amount = undefined;
          ctx.session.paymentTargetTelegramId = undefined;

          await ctx.answerCbQuery('Отправлено без чека');
          await ctx.editMessageText('Оплата добавлена без чека и отправлена на подтверждение админу.', Markup.inlineKeyboard([]));
        } catch (error) {
          const message = error instanceof Error ? error.message : (typeof error === 'object' ? JSON.stringify(error) : String(error));
          this.logger.error(`Failed to create payment: ${message}`);
          await ctx.answerCbQuery('Ошибка при сохранении');
          await ctx.reply('Произошла ошибка при сохранении данных. Попробуйте позже.');
        }
      } else {
        await ctx.answerCbQuery('Действие недействительно');
      }
    });
  }
}
