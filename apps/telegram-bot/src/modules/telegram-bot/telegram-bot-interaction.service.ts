import { Injectable, OnModuleInit, Inject, Logger } from '@nestjs/common';
import { Telegraf, Context, Markup, session } from 'telegraf';
import { ClientProxy } from '@nestjs/microservices';
import { config } from '../../common/config/config';
import { firstValueFrom } from 'rxjs';
import { AdminInteractionService } from '../admin/admin-interaction.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Apartment } from '../admin/types';
import { formatMeterSubmissionMessage, getMeterSubmissionButtons } from './telegram-bot.controller';

export interface MyContext extends Context {
  match?: RegExpExecArray;
  session: {
    state?: 'awaiting_amount' | 'awaiting_photo' | 'awaiting_admin_rent_day' | 'awaiting_admin_rent_amount' | 'admin_editing_rent_day' | 'admin_editing_rent_amount' | 'admin_editing_acc_label' | 'admin_adding_user_name' | 'admin_adding_user_rent_day' | 'admin_adding_user_rent_amount' | 'awaiting_meter_readings';
    amount?: number;
    paymentTargetTelegramId?: string;
    editTenantId?: number;
    editApartmentId?: number;
    editAccountId?: number;
    adminAddingUserData?: {
      name?: string;
      apartmentId?: number;
      rentPaymentDay?: number;
    };
    adminLinkData?: {
      tenantId?: number;
      apartmentId?: number;
      rentPaymentDay?: number;
    };
    attachPhotoData?: {
      fileId?: string;
      filterType?: 'tenant' | 'apartment' | 'account' | 'all';
      selectedEntityId?: number;
    };
    eventId?: number;
    messageId?: number;
    chatId?: number;
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
  ) { }

  onModuleInit() {
    this.bot = new Telegraf<MyContext>(config.TELEGRAM_BOT_TOKEN);
    this.bot.use(session());

    // Admin Guard Middleware: ignore all users except Super Admin (allow channel posts)
    this.bot.use(async (ctx, next) => {
      const isChannel = ctx.chat?.type === 'channel' || ctx.updateType === 'channel_post';
      if (isChannel) {
        return next();
      }

      const isSuperAdmin = ctx.from?.id.toString() === config.SUPER_ADMIN_TELEGRAM_ID;
      if (!isSuperAdmin) {
        // Remain silent for non-admins
        return;
      }
      return next();
    });

    this.setupHandlers();
    this.adminInteractionService.registerHandlers(this.bot);

    this.bot.launch().then(() => {
      this.logger.log('Telegram bot launched (ADMIN ONLY MODE)');
    }).catch(err => {
      this.logger.error('Failed to launch Telegram bot', err);
    });
  }

  private setupHandlers() {
    this.bot.command('register_feed', (ctx) => this.handleRegisterFeed(ctx));
    this.bot.command('unregister_feed', (ctx) => this.handleUnregisterFeed(ctx));
    this.bot.start((ctx) => this.handleStart(ctx));
    this.bot.hears('Список квартир', (ctx) => this.handleListApartments(ctx));
    this.bot.hears('Добавить оплату', (ctx) => this.handleAddPayment(ctx));
    this.bot.action(/admin_pay_apt_(\d+)/, (ctx) => this.handleAdminPayApartmentAction(ctx));
    this.bot.on('text', (ctx, next) => this.handleTextMessage(ctx, next));
    this.bot.on('photo', (ctx) => this.handlePhotoMessage(ctx));
    this.bot.action('skip_receipt_photo', (ctx) => this.handleSkipReceiptPhotoAction(ctx));
    this.bot.action('attach_photo_start', (ctx) => this.handleAttachPhotoStart(ctx));
    this.bot.action('attach_photo_cancel', (ctx) => this.handleAttachPhotoCancel(ctx));
    this.bot.action(/attach_filter_(tenant|apartment|account|all)/, (ctx) => this.handleAttachFilterSelect(ctx));
    this.bot.action(/attach_sel_tenant_(\d+)/, (ctx) => this.handleAttachSelectEntity(ctx, 'tenant'));
    this.bot.action(/attach_sel_apt_(\d+)/, (ctx) => this.handleAttachSelectEntity(ctx, 'apartment'));
    this.bot.action(/attach_sel_acc_(\d+)/, (ctx) => this.handleAttachSelectEntity(ctx, 'account'));
    this.bot.action(/attach_sel_evt_(\d+)/, (ctx) => this.handleAttachSelectEvent(ctx));

    // Handle channel posts for commands manually
    this.bot.on('channel_post', async (ctx, next) => {
      const text = (ctx.channelPost as any)?.text || '';
      if (text.startsWith('/register_feed')) {
        return this.handleRegisterFeed(ctx);
      }
      if (text.startsWith('/unregister_feed')) {
        return this.handleUnregisterFeed(ctx);
      }
      return next();
    });
  }

  private async handleRegisterFeed(ctx: MyContext) {
    if (ctx.chat?.type === 'private') {
      return ctx.reply('⚠️ Эту команду можно использовать только в группах или каналах.');
    }

    const chatId = ctx.chat?.id.toString() || '';
    const chatTitle = (ctx.chat as any)?.title || 'Фид публикаций';

    try {
      await this.prisma.publicationChannel.upsert({
        where: { chatId },
        create: {
          chatId,
          name: chatTitle,
          type: 'feed'
        },
        update: {
          name: chatTitle,
          type: 'feed'
        }
      });
      this.logger.log(`Feed channel registered: "${chatTitle}" (ID: ${chatId})`);

      const adminMessage = `📢 <b>Канал публикаций зарегистрирован</b>\n\n` +
        `🏢 Чат: "${chatTitle}"\n` +
        `🆔 ID: <code>${chatId}</code>`;
      await this.notifyAdmins(ctx, adminMessage);

      await ctx.reply(`✅ Этот чат ("${chatTitle}") успешно зарегистрирован как канал публикации (фид).`);
    } catch (e: any) {
      this.logger.error(`Failed to register feed channel ${chatId}: ${e.message}`);
      await ctx.reply('❌ Ошибка при регистрации канала.');
    }
  }

  private async handleUnregisterFeed(ctx: MyContext) {
    if (ctx.chat?.type === 'private') {
      return ctx.reply('⚠️ Эту команду можно использовать только в группах или каналах.');
    }

    const chatId = ctx.chat?.id.toString() || '';
    try {
      const result = await this.prisma.publicationChannel.deleteMany({
        where: { chatId, type: 'feed' }
      });
      if (result.count > 0) {
        this.logger.log(`Feed channel unregistered (ID: ${chatId})`);

        const adminMessage = `📢 <b>Канал публикаций удален</b>\n\n` +
          `🆔 ID: <code>${chatId}</code>`;
        await this.notifyAdmins(ctx, adminMessage);

        await ctx.reply('✅ Этот чат удален из списка нав каналов публикации (фидов).');
      } else {
        await ctx.reply('⚠️ Этот чат не был зарегистрирован как фид.');
      }
    } catch (e: any) {
      this.logger.error(`Failed to unregister feed channel ${chatId}: ${e.message}`);
      await ctx.reply('❌ Ошибка при удалении канала.');
    }
  }

  private async notifyAdmins(ctx: MyContext, message: string) {
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
          await ctx.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' });
        } catch (err: any) {
          this.logger.error(`Failed to notify admin ${chatId}: ${err.message}`);
        }
      }
    } catch (e: any) {
      this.logger.error(`Failed to notify admins: ${e.message}`);
    }
  }

  private async handleStart(ctx: MyContext) {
    try {
      if (!ctx.from) return;
      // Sync admin user with local DB
      await this.prisma.user.upsert({
        where: { telegramId: BigInt(ctx.from.id) },
        create: {
          telegramId: BigInt(ctx.from.id),
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
          role: 'admin'
        },
        update: {
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
          role: 'admin'
        }
      });

      return ctx.reply('Здравствуйте, администратор! Я бот для учета начислений.', Markup.keyboard([
        ['Добавить оплату', 'Последние инвойсы'],
        ['Список квартир', 'Управление пользователями'],
        ['Запустить сканирование']
      ]).resize());
    } catch (e) {
      this.logger.error('Failed to handle /start', e);
      await ctx.reply('Произошла ошибка при запуске.');
    }
  }

  private async handleListApartments(ctx: MyContext) {
    await this.adminInteractionService.listApartments(ctx);
  }

  private async handleAddPayment(ctx: MyContext) {
    try {
      ctx.session = ctx.session || {};
      const apartments = await firstValueFrom(this.accountantClient.send<Apartment[]>('get_apartments', {}));
      if (!apartments || apartments.length === 0) {
        return ctx.reply('Нет доступных квартир для добавления оплаты.');
      }
      const buttons = apartments.map((apt) => [Markup.button.callback(apt.address || apt.externalId, `admin_pay_apt_${apt.id}`)]);
      return ctx.reply('Выберите квартиру для добавления оплаты:', Markup.inlineKeyboard(buttons));
    } catch (e) {
      await ctx.reply('Произошла ошибка. Попробуйте позже.');
    }
  }

  private async handleAdminPayApartmentAction(ctx: any) {
    const apartmentId = parseInt(ctx.match[1]);
    try {
      const tenant = await firstValueFrom(this.accountantClient.send<any>('get_tenant_by_apartment', apartmentId));
      if (!tenant) {
        return ctx.answerCbQuery('В этой квартире нет активного арендатора.', { show_alert: true });
      }

      const botUser = await this.prisma.user.findUnique({
        where: { tenantId: tenant.id }
      });
      if (!botUser) {
        return ctx.answerCbQuery('У арендатора нет Telegram.', { show_alert: true });
      }

      ctx.session = ctx.session || {};
      ctx.session.state = 'awaiting_amount';
      ctx.session.paymentTargetTelegramId = botUser.telegramId.toString();

      await ctx.answerCbQuery();
      await ctx.editMessageText(`Выбрана квартира. Арендатор: ${tenant.name || 'Неизвестно'}\nВведите сумму оплаты (только число):`, Markup.inlineKeyboard([]));
    } catch (e) {
      this.logger.error('Failed to prepare admin payment', e);
      await ctx.answerCbQuery('Ошибка сервера.');
    }
  }

  private async handleTextMessage(ctx: MyContext, next: () => Promise<void>) {
    if (ctx.session?.state === 'awaiting_meter_readings') {
      const messageObj = ctx.message;
      const text = (messageObj && 'text' in messageObj) ? messageObj.text?.trim() : undefined;
      if (!text) {
        return ctx.reply('Пожалуйста, введите показания текстом.');
      }

      const eventId = ctx.session.eventId;
      const messageId = ctx.session.messageId;
      const chatId = ctx.session.chatId;

      try {
        interface MeterEventResponse {
          id: number;
          status: string;
          periodLabel: string;
          readingsValue?: string | null;
          account: {
            externalId: string;
            accountNumber?: string | null;
            accountLabel?: string | null;
            customLabel?: string | null;
            apartment: {
              address?: string | null;
              externalId: string;
            };
          };
        }

        const res = await firstValueFrom(
          this.accountantClient.send<{ success: boolean; event?: MeterEventResponse; message?: string }>('submit_meter_readings_value', {
            eventId,
            value: text
          })
        );

        if (res && res.success && res.event) {
          const event = res.event;
          const accountLabel = event.account.customLabel || [event.account.accountNumber, event.account.accountLabel].filter(Boolean).join(' ') || event.account.externalId;
          const address = event.account.apartment.address || event.account.apartment.externalId;

          const message = formatMeterSubmissionMessage({
            periodLabel: event.periodLabel,
            apartmentAddress: address,
            accountLabel: accountLabel,
            status: event.status,
            readingsValue: event.readingsValue
          });

          const extra = getMeterSubmissionButtons({
            id: event.id,
            status: event.status
          });

          // Reset state
          ctx.session.state = undefined;
          ctx.session.eventId = undefined;
          ctx.session.messageId = undefined;
          ctx.session.chatId = undefined;

          // Edit original message with new status & buttons
          if (chatId && messageId) {
            try {
              await ctx.telegram.editMessageText(chatId, messageId, undefined, message, { parse_mode: 'HTML', ...extra });
            } catch (editError: unknown) {
              const editMsg = editError instanceof Error ? editError.message : String(editError);
              this.logger.warn(`Failed to edit original message: ${editMsg}`);
            }
          }

          return ctx.reply(`✅ Показания "${text}" успешно сохранены!`);
        } else {
          return ctx.reply(`❌ Ошибка сохранения: ${res?.message || 'Неизвестная ошибка'}`);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to submit readings value: ${msg}`);
        return ctx.reply('❌ Ошибка связи с сервером при сохранении показаний.');
      }
    }

    if (ctx.session?.state === 'awaiting_amount') {
      const amount = parseFloat((ctx.message as any).text.replace(',', '.'));
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
      const day = parseInt((ctx.message as any).text);
      if (isNaN(day) || day < 1 || day > 31) {
        return ctx.reply('Пожалуйста, введите корректный день месяца (от 1 до 31).');
      }
      if (!ctx.session.adminLinkData) ctx.session.adminLinkData = {};
      ctx.session.adminLinkData.rentPaymentDay = day;
      ctx.session.state = 'awaiting_admin_rent_amount';
      return ctx.reply(`День оплаты: ${day}. Теперь введите сумму ежемесячной аренды (только число):`);
    }

    if (ctx.session?.state === 'awaiting_admin_rent_amount') {
      const amount = parseFloat((ctx.message as any).text.replace(',', '.'));
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
      const day = parseInt((ctx.message as any).text);
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
      const amount = parseFloat((ctx.message as any).text.replace(',', '.'));
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

    if (ctx.session?.state === 'admin_editing_acc_label') {
      const label = (ctx.message as any).text.trim();
      try {
        await firstValueFrom(this.accountantClient.send('update_account_custom_label', {
          accountId: ctx.session.editAccountId,
          customLabel: label
        }));
        const aptId = ctx.session.editApartmentId;
        const accId = ctx.session.editAccountId;
        ctx.session.state = undefined;
        ctx.session.editAccountId = undefined;
        ctx.session.editApartmentId = undefined;

        await ctx.reply(`✅ Название аккаунта успешно изменено на "${label}".`);
        if (aptId && accId) {
          await this.adminInteractionService.showAccountMenu(ctx, accId, aptId);
        } else if (aptId) {
          await this.adminInteractionService.showApartmentMenu(ctx, aptId);
        }
        return;
      } catch (e) {
        this.logger.error('Failed to update account label', e);
        return ctx.reply('Ошибка при обновлении названия аккаунта.');
      }
    }

    if (ctx.session?.state === 'admin_adding_user_name') {
      const name = (ctx.message as any).text.trim();
      ctx.session.adminAddingUserData = { name };

      // Show apartment list to pick
      try {
        const apartments = await firstValueFrom(this.accountantClient.send<Apartment[]>('get_apartments', {}));
        if (!apartments || apartments.length === 0) {
          ctx.session.state = undefined;
          return ctx.reply('Нет доступных квартир для привязки. Создайте квартиру в системе сначала.');
        }
        const buttons = apartments.map((apt) => [Markup.button.callback(apt.address || apt.externalId, `admin_add_user_apt_${apt.id}`)]);
        await ctx.reply(`Пользователь: ${name}. Выберите квартиру для привязки:`, Markup.inlineKeyboard(buttons));
        return;
      } catch (e) {
        this.logger.error('Failed to get apartments for add user', e);
        return ctx.reply('Ошибка загрузки квартир.');
      }
    }

    if (ctx.session?.state === 'admin_adding_user_rent_day') {
      const day = parseInt((ctx.message as any).text);
      if (isNaN(day) || day < 1 || day > 31) {
        return ctx.reply('Пожалуйста, введите корректный день месяца (от 1 до 31).');
      }
      if (ctx.session.adminAddingUserData) {
        ctx.session.adminAddingUserData.rentPaymentDay = day;
        ctx.session.state = 'admin_adding_user_rent_amount';
        return ctx.reply(`День оплаты: ${day}. Теперь введите сумму ежемесячной аренды (только число):`);
      }
    }

    if (ctx.session?.state === 'admin_adding_user_rent_amount') {
      const amount = parseFloat((ctx.message as any).text.replace(',', '.'));
      if (isNaN(amount) || amount <= 0) {
        return ctx.reply('Пожалуйста, введите корректную сумму (больше 0).');
      }

      const data = ctx.session.adminAddingUserData;
      if (!data || !data.name || !data.apartmentId || !data.rentPaymentDay) {
        ctx.session.state = undefined;
        return ctx.reply('Ошибка данных. Начните добавление пользователя заново.');
      }

      try {
        await firstValueFrom(this.accountantClient.send('create_active_tenant_manual', {
          name: data.name,
          apartmentId: data.apartmentId,
          rentPaymentDay: data.rentPaymentDay,
          rentAmount: amount
        }));

        ctx.session.state = undefined;
        ctx.session.adminAddingUserData = undefined;

        return ctx.reply(`✅ Пользователь "${data.name}" успешно добавлен и привязан к квартире.`);
      } catch (e) {
        this.logger.error('Failed to create manual tenant', e);
        return ctx.reply('Ошибка при создании пользователя.');
      }
    }

    return next();
  }

  private async handlePhotoMessage(ctx: MyContext) {
    if (ctx.session?.state === 'awaiting_photo') {
      const message = ctx.message as any;
      const photo = message.photo[message.photo.length - 1];
      const amount = ctx.session.amount;
      const targetTelegramId = ctx.session.paymentTargetTelegramId || ctx.from!.id;

      this.logger.log(`Admin ${ctx.from!.id} submitted payment for amount ${amount} (Target: ${targetTelegramId})`);

      // Save to DB via accountant
      try {
        const user = await this.prisma.user.findUnique({
          where: { telegramId: BigInt(targetTelegramId) }
        });
        if (!user || !user.tenantId) {
          throw new Error('Tenant not found in bot database');
        }

        await firstValueFrom(this.accountantClient.send('create_payment', {
          tenantId: user.tenantId,
          userName: ctx.from!.username || ctx.from!.first_name,
          amount,
          receiptPhotoId: photo.file_id
        }));

        ctx.session.state = undefined;
        ctx.session.amount = undefined;
        ctx.session.paymentTargetTelegramId = undefined;

        await ctx.reply('Оплата добавлена и подтверждена.');
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : (typeof error === 'object' ? JSON.stringify(error) : String(error));
        this.logger.error(`Failed to create payment: ${errorMsg}`);
        await ctx.reply('Произошла ошибка при сохранении данных.');
      }
      return;
    }

    // Photo received outside payment flow -> Offer attaching to an event
    const message = ctx.message as any;
    if (message?.photo && message.photo.length > 0) {
      const photo = message.photo[message.photo.length - 1];
      ctx.session = ctx.session || {};
      ctx.session.attachPhotoData = {
        fileId: photo.file_id
      };

      await ctx.reply(
        '📸 <b>Получено изображение!</b>\nВыберите действие с этим файлом:',
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📌 Прикрепить к событию', 'attach_photo_start')],
            [Markup.button.callback('❌ Отмена', 'attach_photo_cancel')]
          ])
        }
      );
    }
  }

  private async handleSkipReceiptPhotoAction(ctx: any) {
    if (ctx.session?.state === 'awaiting_photo') {
      const amount = ctx.session.amount;
      const targetTelegramId = ctx.session.paymentTargetTelegramId || ctx.from.id;

      this.logger.log(`Admin ${ctx.from.id} submitted payment without photo for amount ${amount} (Target: ${targetTelegramId})`);

      try {
        const user = await this.prisma.user.findUnique({
          where: { telegramId: BigInt(targetTelegramId) }
        });
        if (!user || !user.tenantId) {
          throw new Error('Tenant not found in bot database');
        }

        await firstValueFrom(this.accountantClient.send('create_payment', {
          tenantId: user.tenantId,
          userName: ctx.from.username || ctx.from.first_name,
          amount,
          receiptPhotoId: null
        }));

        ctx.session.state = undefined;
        ctx.session.amount = undefined;
        ctx.session.paymentTargetTelegramId = undefined;

        await ctx.answerCbQuery('Отправлено без чека');
        await ctx.editMessageText('Оплата добавлена без чека.', Markup.inlineKeyboard([]));
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : (typeof error === 'object' ? JSON.stringify(error) : String(error));
        this.logger.error(`Failed to create payment: ${errorMsg}`);
        await ctx.answerCbQuery('Ошибка при сохранении');
        await ctx.reply('Произошла ошибка при сохранении данных.');
      }
    } else {
      await ctx.answerCbQuery('Действие недействительно');
    }
  }

  private async handleAttachPhotoCancel(ctx: any) {
    if (ctx.session?.attachPhotoData) {
      ctx.session.attachPhotoData = undefined;
    }
    await ctx.answerCbQuery();
    await ctx.editMessageText('❌ Действие отменено.');
  }

  private async handleAttachPhotoStart(ctx: any) {
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      '🔍 <b>Выберите фильтр для поиска события:</b>',
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('👤 По арендатору', 'attach_filter_tenant')],
          [Markup.button.callback('🏢 По квартире', 'attach_filter_apartment')],
          [Markup.button.callback('📑 По лицевому счету', 'attach_filter_account')],
          [Markup.button.callback('🌐 Все активные события', 'attach_filter_all')],
          [Markup.button.callback('❌ Отмена', 'attach_photo_cancel')]
        ])
      }
    );
  }

  private async handleAttachFilterSelect(ctx: any) {
    const filterType = ctx.match[1] as 'tenant' | 'apartment' | 'account' | 'all';
    await ctx.answerCbQuery();

    if (filterType === 'all') {
      try {
        const events = await firstValueFrom(
          this.accountantClient.send<any[]>('get_scheduled_events_filtered', { activeOnly: true })
        );
        if (!events || events.length === 0) {
          return ctx.editMessageText('⚠️ Активных событий не найдено.', Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Назад к фильтрам', 'attach_photo_start')]
          ]));
        }
        const buttons = events.map(evt => [
          Markup.button.callback(`📅 ${evt.title}`, `attach_sel_evt_${evt.id}`)
        ]);
        buttons.push([Markup.button.callback('🔙 Назад к фильтрам', 'attach_photo_start')]);
        return ctx.editMessageText('📋 <b>Выберите событие:</b>', {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(buttons)
        });
      } catch (e) {
        this.logger.error('Failed to fetch all events', e);
        return ctx.editMessageText('❌ Ошибка при получении событий.');
      }
    }

    if (filterType === 'tenant') {
      try {
        const tenants = await firstValueFrom(
          this.accountantClient.send<any[]>('get_all_tenants', {})
        );
        if (!tenants || tenants.length === 0) {
          return ctx.editMessageText('⚠️ Арендаторы не найдены.', Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Назад', 'attach_photo_start')]
          ]));
        }
        const buttons = tenants.map(t => [
          Markup.button.callback(`👤 ${t.user?.name || `Арендатор #${t.id}`} ${t.apartment?.address ? `(${t.apartment.address})` : ''}`, `attach_sel_tenant_${t.id}`)
        ]);
        buttons.push([Markup.button.callback('🔙 Назад', 'attach_photo_start')]);
        return ctx.editMessageText('👤 <b>Выберите арендатора:</b>', {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(buttons)
        });
      } catch (e) {
        this.logger.error('Failed to fetch tenants', e);
        return ctx.editMessageText('❌ Ошибка при получении списка арендаторов.');
      }
    }

    if (filterType === 'apartment') {
      try {
        const apartments = await firstValueFrom(
          this.accountantClient.send<any[]>('get_apartments', {})
        );
        if (!apartments || apartments.length === 0) {
          return ctx.editMessageText('⚠️ Квартиры не найдены.', Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Назад', 'attach_photo_start')]
          ]));
        }
        const buttons = apartments.map(apt => [
          Markup.button.callback(`🏢 ${apt.address || apt.externalId}`, `attach_sel_apt_${apt.id}`)
        ]);
        buttons.push([Markup.button.callback('🔙 Назад', 'attach_photo_start')]);
        return ctx.editMessageText('🏢 <b>Выберите квартиру:</b>', {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(buttons)
        });
      } catch (e) {
        this.logger.error('Failed to fetch apartments', e);
        return ctx.editMessageText('❌ Ошибка при получении списка квартир.');
      }
    }

    if (filterType === 'account') {
      try {
        const apartments = await firstValueFrom(
          this.accountantClient.send<any[]>('get_apartments', {})
        );
        const buttons: any[] = [];
        for (const apt of apartments || []) {
          for (const acc of apt.accounts || []) {
            const label = acc.customLabel || [acc.accountNumber, acc.accountLabel].filter(Boolean).join(' ') || acc.externalId;
            buttons.push([
              Markup.button.callback(`📑 Счёт: ${label} (${apt.address || ''})`, `attach_sel_acc_${acc.id}`)
            ]);
          }
        }
        if (buttons.length === 0) {
          return ctx.editMessageText('⚠️ Лицевые счета не найдены.', Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Назад', 'attach_photo_start')]
          ]));
        }
        buttons.push([Markup.button.callback('🔙 Назад', 'attach_photo_start')]);
        return ctx.editMessageText('📑 <b>Выберите лицевой счет:</b>', {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(buttons)
        });
      } catch (e) {
        this.logger.error('Failed to fetch accounts', e);
        return ctx.editMessageText('❌ Ошибка при получении списка счетов.');
      }
    }
  }

  private async handleAttachSelectEntity(ctx: any, type: 'tenant' | 'apartment' | 'account') {
    const entityId = parseInt(ctx.match[1]);
    await ctx.answerCbQuery();

    const filters: any = { activeOnly: true };
    if (type === 'tenant') filters.tenantId = entityId;
    if (type === 'apartment') filters.apartmentId = entityId;
    if (type === 'account') filters.accountId = entityId;

    try {
      const events = await firstValueFrom(
        this.accountantClient.send<any[]>('get_scheduled_events_filtered', filters)
      );

      if (!events || events.length === 0) {
        return ctx.editMessageText('⚠️ Для выбранного объекта не найдено активных событий.', Markup.inlineKeyboard([
          [Markup.button.callback('🔙 Назад к фильтрам', 'attach_photo_start')]
        ]));
      }

      const buttons = events.map(evt => [
        Markup.button.callback(`📅 ${evt.title}`, `attach_sel_evt_${evt.id}`)
      ]);
      buttons.push([Markup.button.callback('🔙 Назад к фильтрам', 'attach_photo_start')]);

      return ctx.editMessageText('📋 <b>Выберите событие для прикрепления файла:</b>', {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
      });
    } catch (e) {
      this.logger.error(`Failed to fetch events for ${type} #${entityId}`, e);
      return ctx.editMessageText('❌ Ошибка при получении событий.');
    }
  }

  private async handleAttachSelectEvent(ctx: any) {
    const eventId = parseInt(ctx.match[1]);
    const fileId = ctx.session?.attachPhotoData?.fileId;

    if (!fileId) {
      await ctx.answerCbQuery('Изображение не найдено в сессии.', { show_alert: true });
      return ctx.editMessageText('❌ Ошибка сессии: фотография не найдена.');
    }

    await ctx.answerCbQuery('Загрузка файла и прикрепление...');
    await ctx.editMessageText('⏳ <b>Загрузка фотографии в S3...</b>', { parse_mode: 'HTML' });

    try {
      // 1. Get file link from Telegram
      const fileLink = await ctx.telegram.getFileLink(fileId);
      const fileRes = await fetch(fileLink.href);
      if (!fileRes.ok) {
        throw new Error(`Failed to download file from Telegram: ${fileRes.statusText}`);
      }
      const arrayBuffer = await fileRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const fileBufferBase64 = buffer.toString('base64');

      // 2. Attach document via accountant microservice
      const result = await firstValueFrom(
        this.accountantClient.send<any>('attach_event_document', {
          scheduledEventId: eventId,
          fileName: `photo_${Date.now()}.jpg`,
          fileBufferBase64,
          mimeType: 'image/jpeg',
          telegramFileId: fileId,
          uploadedBy: ctx.from?.username || ctx.from?.first_name || 'telegram-admin'
        })
      );

      ctx.session.attachPhotoData = undefined;

      const successMsg = `✅ <b>Документ успешно прикреплен к событию!</b>\n\n` +
        `📁 Имя файла: <code>${result.fileName}</code>\n` +
        `☁️ Загружено в S3 storage\n` +
        `Файл доступен в панели администратора на странице события.`;

      await ctx.editMessageText(successMsg, { parse_mode: 'HTML' });
    } catch (e: any) {
      this.logger.error(`Failed to attach document to event #${eventId}`, e);
      await ctx.editMessageText(`❌ Ошибка при загрузке и прикреплении документа: ${e.message || String(e)}`);
    }
  }
}

