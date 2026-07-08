import { Injectable, OnModuleInit, Inject, Logger } from '@nestjs/common';
import { Telegraf, Context, Markup, session } from 'telegraf';
import { ClientProxy } from '@nestjs/microservices';
import { config } from '../../common/config/config';
import { firstValueFrom } from 'rxjs';
import { AdminInteractionService } from '../admin/admin-interaction.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Apartment } from '../admin/types';

interface MyContext extends Context {
  session: {
    state?: 'awaiting_amount' | 'awaiting_photo' | 'awaiting_admin_rent_day' | 'awaiting_admin_rent_amount' | 'admin_editing_rent_day' | 'admin_editing_rent_amount' | 'admin_editing_acc_label' | 'admin_adding_user_name' | 'admin_adding_user_rent_day' | 'admin_adding_user_rent_amount';
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
      this.logger.log(`Feed channel registered: "${chatTitle}" (ID: ${chatId}) by admin ${ctx.from?.id}`);
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
        this.logger.log(`Feed channel unregistered (ID: ${chatId}) by admin ${ctx.from?.id}`);
        await ctx.reply('✅ Этот чат удален из списка нав каналов публикации (фидов).');
      } else {
        await ctx.reply('⚠️ Этот чат не был зарегистрирован как фид.');
      }
    } catch (e: any) {
      this.logger.error(`Failed to unregister feed channel ${chatId}: ${e.message}`);
      await ctx.reply('❌ Ошибка при удалении канала.');
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
        ['Добавить оплату', 'Список квартир'],
        ['Управление пользователями', 'Запустить сканирование']
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
}
