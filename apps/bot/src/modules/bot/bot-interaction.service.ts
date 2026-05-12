import { Injectable, OnModuleInit, Inject, Logger } from '@nestjs/common';
import { Telegraf, Context, Markup, session } from 'telegraf';
import { ClientProxy } from '@nestjs/microservices';
import { config } from '../../common/config/config';
import { firstValueFrom } from 'rxjs';

interface MyContext extends Context {
  session: {
    state?: 'awaiting_amount' | 'awaiting_photo';
    amount?: number;
  };
}

@Injectable()
export class BotInteractionService implements OnModuleInit {
  private readonly logger = new Logger(BotInteractionService.name);
  private bot: Telegraf<MyContext>;

  constructor(
    @Inject('ACCOUNTANT_SERVICE') private readonly accountantClient: ClientProxy
  ) {}

  onModuleInit() {
    this.bot = new Telegraf<MyContext>(config.TELEGRAM_BOT_TOKEN);
    this.bot.use(session());
    this.setupHandlers();
    this.bot.launch().then(() => {
      this.logger.log('Telegram bot launched');
    }).catch(err => {
      this.logger.error('Failed to launch Telegram bot', err);
    });
  }

  private setupHandlers() {
    this.bot.start((ctx) => {
      ctx.reply('Привет! Я бот для учета начислений.', Markup.keyboard([
        ['Добавить оплату']
      ]).resize());
    });

    this.bot.hears('Добавить оплату', (ctx) => {
      ctx.session = ctx.session || {};
      ctx.session.state = 'awaiting_amount';
      ctx.reply('Введите сумму оплаты (только число):');
    });

    this.bot.on('text', async (ctx, next) => {
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

    this.bot.action(/confirm_payment_(\d+)/, async (ctx) => {
      const paymentId = parseInt(ctx.match[1]);
      try {
        await firstValueFrom(this.accountantClient.send('confirm_payment', {
          paymentId,
          confirmedBy: ctx.from.id
        }));
        await ctx.editMessageCaption(`✅ Оплата #${paymentId} подтверждена.`);
        await ctx.answerCbQuery('Оплата подтверждена');
        this.logger.log(`Payment ${paymentId} confirmed by ${ctx.from.id}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to confirm payment ${paymentId}: ${message}`);
        await ctx.answerCbQuery('Ошибка при подтверждении');
      }
    });

    this.bot.action(/reject_payment_(\d+)/, async (ctx) => {
      const paymentId = parseInt(ctx.match[1]);
      try {
        await firstValueFrom(this.accountantClient.send('reject_payment', {
          paymentId,
          confirmedBy: ctx.from.id,
          comment: 'Отклонено админом'
        }));
        await ctx.editMessageCaption(`❌ Оплата #${paymentId} отклонена.`);
        await ctx.answerCbQuery('Оплата отклонена');
        this.logger.log(`Payment ${paymentId} rejected by ${ctx.from.id}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to reject payment ${paymentId}: ${message}`);
        await ctx.answerCbQuery('Ошибка при отклонении');
      }
    });
  }
}
