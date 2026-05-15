import { Injectable, OnModuleInit, Inject, Logger } from '@nestjs/common';
import { Telegraf, Context, Markup, session } from 'telegraf';
import { ClientProxy } from '@nestjs/microservices';
import { config } from '../../common/config/config';
import { firstValueFrom } from 'rxjs';
import { AdminInteractionService } from '../admin/admin-interaction.service';
import { PrismaService } from '../../common/prisma/prisma.service';

interface MyContext extends Context {
  session: {
    state?: 'awaiting_registration_name' | 'awaiting_registration_phone' | 'awaiting_amount' | 'awaiting_photo';
    amount?: number;
    regData?: {
      name?: string;
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
        ctx.session.state = 'awaiting_amount';
        ctx.reply('Введите сумму оплаты (только число):');
      } catch (e) {
        ctx.reply('Произошла ошибка. Попробуйте позже.');
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
        return ctx.reply('Пришлите фотографию чека/подтверждения:');
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
            userId: ctx.from.id,
            userName: ctx.from.username || ctx.from.first_name,
            amount,
            receiptPhotoId: photo.file_id
          }));

          ctx.session.state = undefined;
          ctx.session.amount = undefined;

          await ctx.reply('Оплата добавлена и отправлена на подтверждение админу.');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(`Failed to create payment: ${message}`);
          await ctx.reply('Произошла ошибка при сохранении данных. Попробуйте позже.');
        }
      }
    });
  }
}
