import { Injectable, Inject, Logger } from '@nestjs/common';
import { Telegraf, Markup } from 'telegraf';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { config } from '../../common/config/config';

@Injectable()
export class AdminInteractionService {
  private readonly logger = new Logger(AdminInteractionService.name);

  constructor(
    @Inject('ACCOUNTANT_SERVICE') private readonly accountantClient: ClientProxy,
    private readonly prisma: PrismaService
  ) {}

  registerHandlers(bot: Telegraf<any>) {
    // Admin Menu - List Pending Tenants
    bot.hears('Админ Меню', async (ctx) => {
      try {
        const user = await this.prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
        if (!user || user.role !== 'admin') {
          return ctx.reply('Нет доступа.');
        }

        const pendingTenants = await firstValueFrom(this.accountantClient.send('get_pending_tenants', {}));
        if (!pendingTenants || pendingTenants.length === 0) {
          return ctx.reply('Нет заявок на регистрацию в ожидании.');
        }

        for (const tenant of pendingTenants) {
           await ctx.reply(`Заявка от: ${tenant.user?.name || 'Неизвестно'}\nID: ${tenant.id}`, Markup.inlineKeyboard([
             Markup.button.callback('Привязать к квартире', `admin_link_tenant_${tenant.id}`),
             Markup.button.callback('❌ Отклонить', `admin_reject_tenant_${tenant.id}`)
           ]));
        }
      } catch (e) {
        this.logger.error('Failed to get pending tenants', e);
        ctx.reply('Произошла ошибка. Попробуйте позже.');
      }
    });

    // User Management - List All Users from local Bot DB
    bot.hears('Управление пользователями', async (ctx) => {
      try {
        const user = await this.prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
        if (!user || user.role !== 'admin') {
          return ctx.reply('Нет доступа.');
        }

        const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
        if (!users || users.length === 0) {
          return ctx.reply('Пользователей не найдено в базе бота.');
        }

        for (const u of users) {
           const roleStr = u.role === 'admin' ? '(Админ)' : '(Арендатор)';
           const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || 'Неизвестно';
           const isSuperAdmin = u.telegramId.toString() === config.SUPER_ADMIN_TELEGRAM_ID;

           const buttons = [];
           if (!isSuperAdmin) {
             buttons.push(Markup.button.callback('❌ Удалить', `admin_delete_user_${u.id}`));
           }
           
           await ctx.reply(`👤 <b>${name}</b> ${roleStr}\nTG ID: ${u.telegramId}`, {
             parse_mode: 'HTML',
             ...(buttons.length > 0 ? Markup.inlineKeyboard(buttons) : {})
           });
        }
      } catch (e) {
        this.logger.error('Failed to get users from local DB', e);
        ctx.reply('Произошла ошибка при загрузке пользователей.');
      }
    });

    // Action: Confirm Delete User (Step 1)
    bot.action(/admin_delete_user_(\d+)/, async (ctx) => {
      const userId = parseInt(ctx.match[1]);
      await ctx.editMessageReplyMarkup(Markup.inlineKeyboard([
        Markup.button.callback('⚠️ Подтвердить удаление', `admin_confirm_delete_${userId}`),
        Markup.button.callback('↩️ Отмена', `admin_cancel_delete_${userId}`)
      ]).reply_markup);
      await ctx.answerCbQuery();
    });

    // Action: Cancel Delete User
    bot.action(/admin_cancel_delete_(\d+)/, async (ctx) => {
      const userId = parseInt(ctx.match[1]);
      await ctx.editMessageReplyMarkup(Markup.inlineKeyboard([
        Markup.button.callback('❌ Удалить', `admin_delete_user_${userId}`)
      ]).reply_markup);
      await ctx.answerCbQuery('Отменено');
    });

    // Action: Final Delete User (Step 2)
    bot.action(/admin_confirm_delete_(\d+)/, async (ctx) => {
      const userId = parseInt(ctx.match[1]);
      try {
        const userToDelete = await this.prisma.user.findUnique({ where: { id: userId } });
        if (userToDelete) {
          // 1. Delete from Accountant if exists (by telegramId)
          try {
            await firstValueFrom(this.accountantClient.send('delete_user_by_tg', { telegramId: userToDelete.telegramId.toString() }));
          } catch (e) {
            this.logger.warn(`Failed to delete user ${userToDelete.telegramId} from Accountant (might not exist)`);
          }

          // 2. Delete from local Bot DB
          await this.prisma.user.delete({ where: { id: userId } });
          
          await ctx.editMessageText(`❌ Пользователь TG:${userToDelete.telegramId} удален из бота и основной системы.`);
          await ctx.answerCbQuery('Пользователь удален');
        } else {
          await ctx.answerCbQuery('Пользователь не найден');
        }
      } catch (e) {
        this.logger.error('Failed to delete user', e);
        await ctx.answerCbQuery('Ошибка при удалении пользователя');
      }
    });

    // Action: Link Tenant to Apartment (Step 1: List Apartments)
    bot.action(/admin_link_tenant_(\d+)/, async (ctx) => {
      const tenantId = parseInt(ctx.match[1]);
      try {
        const apartments = await firstValueFrom(this.accountantClient.send('get_apartments', {}));
        if (!apartments || apartments.length === 0) {
          return ctx.answerCbQuery('Нет доступных квартир в базе.', { show_alert: true });
        }

        const buttons = apartments.map((apt: any) => [Markup.button.callback(apt.address || apt.externalId, `admin_confirm_link_${tenantId}_${apt.id}`)]);
        
        await ctx.editMessageText('Выберите квартиру для привязки:', Markup.inlineKeyboard(buttons));
      } catch (e) {
        this.logger.error('Failed to get apartments', e);
        await ctx.answerCbQuery('Ошибка загрузки квартир');
      }
    });

    // Action: Confirm Linking (Step 2)
    bot.action(/admin_confirm_link_(\d+)_(\d+)/, async (ctx) => {
      const tenantId = parseInt(ctx.match[1]);
      const apartmentId = parseInt(ctx.match[2]);
      
      const sessionCtx = ctx as any;
      sessionCtx.session = sessionCtx.session || {};
      sessionCtx.session.state = 'awaiting_admin_rent_day';
      sessionCtx.session.adminLinkData = { tenantId, apartmentId };

      await ctx.editMessageText(`Укажите день месяца для оплаты аренды (от 1 до 31):`, Markup.inlineKeyboard([]));
      await ctx.answerCbQuery();
    });

    // Action: Reject Tenant
    bot.action(/admin_reject_tenant_(\d+)/, async (ctx) => {
      const tenantId = parseInt(ctx.match[1]);
      try {
        await firstValueFrom(this.accountantClient.send('reject_tenant', { tenantId }));
        await ctx.editMessageText(`❌ Заявка на регистрацию отклонена.`);
        await ctx.answerCbQuery('Заявка отклонена');
      } catch (e) {
        this.logger.error('Failed to reject tenant', e);
        await ctx.answerCbQuery('Ошибка при отклонении');
      }
    });

    // Action: Confirm Payment
    bot.action(/confirm_payment_(\d+)/, async (ctx) => {
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

    // Action: Reject Payment
    bot.action(/reject_payment_(\d+)/, async (ctx) => {
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
