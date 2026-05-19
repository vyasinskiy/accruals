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

  getAccountDisplayName(acc: any) {
    if (acc.customLabel) return acc.customLabel;
    const fallback = [acc.accountNumber, acc.accountLabel].filter(Boolean).join(' ');
    return fallback || acc.externalId;
  }

  async showApartmentMenu(ctx: any, apartmentId: number) {
    try {
      const apartments = await firstValueFrom(this.accountantClient.send('get_apartments', { id: apartmentId }));
      const apt = apartments.find((a: any) => a.id === apartmentId);
      if (!apt) return ctx.reply('Квартира не найдена.');

      const tenant = apt.tenants?.[0];
      const tenantName = tenant?.user?.name || 'Нет арендатора';
      
      // Calculate Debt (using new balance field if available)
      let debtInfo = '';
      let lastUpdate: Date | null = null;

      if (apt.accounts && apt.accounts.length > 0) {
        const totalBalance = apt.accounts.reduce((sum: number, acc: any) => {
          if (acc.lastSeenAt) {
            const date = new Date(acc.lastSeenAt);
            if (!lastUpdate || date > lastUpdate) lastUpdate = date;
          }
          return sum + (Number(acc.balance) || 0);
        }, 0);

        if (totalBalance < 0) {
          debtInfo = `🔴 <b>Задолженность: ${Math.abs(totalBalance).toFixed(2)}</b>\n`;
        } else if (totalBalance > 0) {
          debtInfo = `🟢 <b>Переплата (аванс): ${totalBalance.toFixed(2)}</b>\n`;
        } else {
          debtInfo = `⚪️ <b>Баланс: 0.00</b>\n`;
        }
        
        apt.accounts.forEach((acc: any) => {
          const bal = Number(acc.balance || 0);
          const label = bal < 0 ? 'Задолженность' : (bal > 0 ? 'Переплата' : 'Баланс');
          const displayName = this.getAccountDisplayName(acc);
          debtInfo += `  ▫️ ${displayName}: ${label} ${Math.abs(bal).toFixed(2)}\n`;
        });

        if (lastUpdate) {
          const dateStr = (lastUpdate as Date).toLocaleString('ru-RU');
          debtInfo += `\n<i>Обновлено: ${dateStr}</i>`;
        }
      } else {
        debtInfo = 'Задолженность: Нет данных';
      }

      const message = `🏠 <b>Квартира: ${apt.address}</b>\n` +
        `👤 Арендатор: ${tenantName}\n` +
        `📅 День оплаты: ${tenant?.rentPaymentDay || 'Не задан'}\n` +
        `💰 Сумма: ${tenant?.rentAmount || 'Не задана'}\n\n` +
        `${debtInfo}`;

      const buttons = [];
      if (tenant) {
        buttons.push([Markup.button.callback('📅 Изменить день оплаты', `admin_edit_rent_day_${tenant.id}_${apt.id}`)]);
        buttons.push([Markup.button.callback('💰 Изменить сумму аренды', `admin_edit_rent_amount_${tenant.id}_${apt.id}`)]);
      }
      
      buttons.push([Markup.button.callback('💳 Управление аккаунтами', `admin_manage_accounts_${apt.id}`)]);
      buttons.push([Markup.button.callback('🔍 Проверить задолженность', `admin_check_debt_${apt.id}`)]);
      buttons.push([Markup.button.callback('↩️ К списку квартир', 'admin_list_apartments')]);

      const method = ctx.callbackQuery ? 'editMessageText' : 'reply';
      await (ctx as any)[method](message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
      });
    } catch (e: any) {
      if (e.description?.includes('message is not modified')) {
        return; // Ignore if message didn't change
      }
      this.logger.error('Failed to open apartment menu', e);
      await ctx.reply('Ошибка загрузки данных квартиры.');
    }
  }

  async showAccountsList(ctx: any, apartmentId: number) {
    try {
      const apartments = await firstValueFrom(this.accountantClient.send('get_apartments', { id: apartmentId }));
      const apt = apartments.find((a: any) => a.id === apartmentId);
      if (!apt) return ctx.reply('Квартира не найдена.');

      const message = `💳 <b>Аккаунты квартиры: ${apt.address}</b>\nВыберите аккаунт для управления:`;
      const buttons = (apt.accounts || []).map((acc: any) => {
        const label = this.getAccountDisplayName(acc);
        return [
          Markup.button.callback(label, `admin_account_menu_${acc.id}_${apt.id}`)
        ];
      });
      buttons.push([Markup.button.callback('↩️ Назад к квартире', `admin_apt_menu_${apt.id}`)]);

      await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
      });
    } catch (e) {
      this.logger.error('Failed to show accounts list', e);
      await ctx.answerCbQuery('Ошибка загрузки списка аккаунтов');
    }
  }

  async showAccountMenu(ctx: any, accountId: number, apartmentId: number) {
    try {
      const apartments = await firstValueFrom(this.accountantClient.send('get_apartments', { id: apartmentId }));
      const apt = apartments.find((a: any) => a.id === apartmentId);
      const acc = apt?.accounts?.find((a: any) => a.id === accountId);
      if (!acc) return ctx.reply('Аккаунт не найден.');

      const displayName = this.getAccountDisplayName(acc);
      const bal = Number(acc.balance || 0);
      const label = bal < 0 ? 'Задолженность' : (bal > 0 ? 'Переплата' : 'Баланс');

      const message = `⚙️ <b>Управление аккаунтом: ${displayName}</b>\n` +
        `🌐 Внешний ID: <code>${acc.externalId}</code>\n` +
        `🏷 Оригинальное название: ${acc.accountLabel || 'Нет'}\n` +
        `📊 ${label}: ${Math.abs(bal).toFixed(2)}\n`;

      const buttons = [
        [Markup.button.callback('✏️ Переименовать', `admin_edit_acc_label_${acc.id}_${apt.id}`)],
        [Markup.button.callback('📄 Получить инвойс', `admin_list_account_invoices_${acc.id}_${apt.id}`)],
        [Markup.button.callback('↩️ Назад к списку аккаунтов', `admin_manage_accounts_${apt.id}`)]
      ];

      await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
      });
    } catch (e) {
      this.logger.error('Failed to show account menu', e);
      await ctx.answerCbQuery('Ошибка загрузки меню аккаунта');
    }
  }

  async showAccountInvoices(ctx: any, accountId: number, apartmentId: number) {
    try {
      const apartments = await firstValueFrom(this.accountantClient.send('get_apartments', { id: apartmentId }));
      const apt = apartments.find((a: any) => a.id === apartmentId);
      const acc = apt?.accounts?.find((a: any) => a.id === accountId);
      if (!acc) return ctx.reply('Аккаунт не найден.');

      const displayName = this.getAccountDisplayName(acc);
      const invoices = await firstValueFrom(this.accountantClient.send('get_invoices', { accountId, take: 12 }));
      
      const message = `📄 <b>Последние инвойсы: ${displayName}</b>\nВыберите период для получения ссылки:`;
      
      const buttons = (invoices || []).map((inv: any) => [
        Markup.button.callback(inv.periodLabel, `admin_get_invoice_${inv.id}`)
      ]);
      buttons.push([Markup.button.callback('↩️ Назад к аккаунту', `admin_account_menu_${accountId}_${apartmentId}`)]);

      await ctx.editMessageText(message, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
      });
    } catch (e) {
      this.logger.error('Failed to show account invoices', e);
      await ctx.answerCbQuery('Ошибка загрузки списка инвойсов');
    }
  }

  registerHandlers(bot: Telegraf<any>) {
    // Admin Menu - Show Pending Tenants AND Apartments
    bot.hears('Админ Меню', async (ctx) => {
      try {
        const user = await this.prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) } });
        if (!user || user.role !== 'admin') {
          return ctx.reply('Нет доступа.');
        }

        // 1. Pending Tenants
        const pendingTenants = await firstValueFrom(this.accountantClient.send('get_pending_tenants', {}));
        if (pendingTenants && pendingTenants.length > 0) {
          await ctx.reply(`📝 <b>Заявки на регистрацию (${pendingTenants.length}):</b>`, { parse_mode: 'HTML' });
          for (const tenant of pendingTenants) {
             await ctx.reply(`Заявка от: ${tenant.user?.name || 'Неизвестно'}\nТелефон: ${tenant.phone || 'Неизвестно'}\nID: ${tenant.id}`, Markup.inlineKeyboard([
               Markup.button.callback('Привязать к квартире', `admin_link_tenant_${tenant.id}`),
               Markup.button.callback('❌ Отклонить', `admin_reject_tenant_${tenant.id}`)
             ]));
          }
        } else {
          await ctx.reply('📝 Нет заявок на регистрацию в ожидании.');
        }

        // 2. Apartments List button
        await ctx.reply('🏠 <b>Управление квартирами</b>\nНажмите кнопку ниже, чтобы просмотреть список квартир и их настройки:', {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📂 Список квартир', 'admin_list_apartments')]
          ])
        });

      } catch (e) {
        this.logger.error('Failed to open admin menu', e);
        ctx.reply('Произошла ошибка. Попробуйте позже.');
      }
    });

    // Action: List Apartments
    bot.action('admin_list_apartments', async (ctx) => {
      try {
        const apartments = await firstValueFrom(this.accountantClient.send('get_apartments', {}));
        if (!apartments || apartments.length === 0) {
          return ctx.answerCbQuery('Квартиры не найдены.');
        }

        await ctx.answerCbQuery();
        await ctx.reply('🏠 <b>Выберите квартиру:</b>', {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard(
            apartments.map((apt: any) => [Markup.button.callback(apt.address || apt.externalId, `admin_apt_menu_${apt.id}`)])
          )
        });
      } catch (e) {
        this.logger.error('Failed to list apartments', e);
        await ctx.answerCbQuery('Ошибка загрузки списка.');
      }
    });

    // Action: Apartment Submenu
    bot.action(/admin_apt_menu_(\d+)/, async (ctx) => {
      const apartmentId = parseInt(ctx.match[1]);
      await this.showApartmentMenu(ctx, apartmentId);
      await ctx.answerCbQuery();
    });

    // Action: Manage Accounts List
    bot.action(/admin_manage_accounts_(\d+)/, async (ctx) => {
      const apartmentId = parseInt(ctx.match[1]);
      await this.showAccountsList(ctx, apartmentId);
      await ctx.answerCbQuery();
    });

    // Action: Account Menu
    bot.action(/admin_account_menu_(\d+)_(\d+)/, async (ctx) => {
      const accountId = parseInt(ctx.match[1]);
      const apartmentId = parseInt(ctx.match[2]);
      await this.showAccountMenu(ctx, accountId, apartmentId);
      await ctx.answerCbQuery();
    });

    // Action: List Account Invoices
    bot.action(/admin_list_account_invoices_(\d+)_(\d+)/, async (ctx) => {
      const accountId = parseInt(ctx.match[1]);
      const apartmentId = parseInt(ctx.match[2]);
      await this.showAccountInvoices(ctx, accountId, apartmentId);
      await ctx.answerCbQuery();
    });

    // Action: Get Single Invoice Link
    bot.action(/admin_get_invoice_(\d+)/, async (ctx) => {
      const invoiceId = parseInt(ctx.match[1]);
      try {
        const { invoice, downloadUrl } = await firstValueFrom(this.accountantClient.send('get_invoice', invoiceId));
        if (!downloadUrl) {
          return ctx.answerCbQuery('PDF инвойса не найден в S3', { show_alert: true });
        }
        
        // 1. Send description message
        await ctx.reply(`📄 <b>Инвойс за ${invoice.periodLabel}</b>`, { parse_mode: 'HTML' });

        // 2. Send the document itself (NO CAPTION for easy forwarding)
        await ctx.replyWithDocument({
          url: downloadUrl,
          filename: `${invoice.periodLabel}_${invoice.accountExternalId}.pdf`
        });

        await ctx.answerCbQuery();
      } catch (e) {
        this.logger.error('Failed to get invoice document', e);
        await ctx.answerCbQuery('Ошибка получения файла');
      }
    });

    // Action: Check Debt (Send separate message)
    bot.action(/admin_check_debt_(\d+)/, async (ctx) => {
      const apartmentId = parseInt(ctx.match[1]);
      try {
        const apartments = await firstValueFrom(this.accountantClient.send('get_apartments', { id: apartmentId }));
        const apt = apartments.find((a: any) => a.id === apartmentId);
        if (!apt) return ctx.answerCbQuery('Квартира не найдена.');

        let debtInfo = `🔍 <b>Проверка задолженности: ${apt.address}</b>\n\n`;
        let lastUpdate: Date | null = null;
        const invoicesToSend: any[] = [];

        if (apt.accounts && apt.accounts.length > 0) {
          const totalBalance = apt.accounts.reduce((sum: number, acc: any) => {
            if (acc.lastSeenAt) {
              const date = new Date(acc.lastSeenAt);
              if (!lastUpdate || date > lastUpdate) lastUpdate = date;
            }
            return sum + (Number(acc.balance) || 0);
          }, 0);

          if (totalBalance < 0) {
            debtInfo += `🔴 <b>Задолженность: ${Math.abs(totalBalance).toFixed(2)}</b>\n`;
          } else if (totalBalance > 0) {
            debtInfo += `🟢 <b>Переплата (аванс): ${totalBalance.toFixed(2)}</b>\n`;
          } else {
            debtInfo += `⚪️ <b>Баланс: 0.00</b>\n`;
          }
          
          for (const acc of apt.accounts) {
            const bal = Number(acc.balance || 0);
            const label = bal < 0 ? 'Задолженность' : (bal > 0 ? 'Переплата' : 'Баланс');
            const displayName = this.getAccountDisplayName(acc);
            debtInfo += `  ▫️ ${displayName}: ${label} ${Math.abs(bal).toFixed(2)}\n`;
            
            // If there is debt, collect latest invoice link
            if (bal < 0) {
              try {
                const invoices = await firstValueFrom(this.accountantClient.send('get_invoices', { accountId: acc.id, take: 1 }));
                if (invoices && invoices.length > 0) {
                  const { downloadUrl } = await firstValueFrom(this.accountantClient.send('get_invoice', invoices[0].id));
                  if (downloadUrl) {
                    invoicesToSend.push({
                      displayName,
                      periodLabel: invoices[0].periodLabel,
                      url: downloadUrl,
                      filename: `${invoices[0].periodLabel}_${acc.externalId}.pdf`
                    });
                  }
                }
              } catch (err) {
                this.logger.warn(`Failed to fetch invoice for debt check: ${acc.id}`);
              }
            }
          }

          if (lastUpdate) {
            const dateStr = (lastUpdate as Date).toLocaleString('ru-RU');
            debtInfo += `\n<i>Обновлено: ${dateStr}</i>`;
          }
        } else {
          debtInfo += 'Задолженность: Нет данных';
        }

        // 1. Send summary message first
        await ctx.reply(debtInfo, { parse_mode: 'HTML' });

        // 2. Send invoices afterwards
        for (const inv of invoicesToSend) {
            await ctx.reply(`📄 Инвойс: ${inv.displayName} (${inv.periodLabel})`);
            await ctx.replyWithDocument({
                url: inv.url,
                filename: inv.filename
            });
        }

        await ctx.answerCbQuery('Проверка завершена');
      } catch (e) {
        this.logger.error('Failed to check debt', e);
        await ctx.answerCbQuery('Ошибка при проверке');
      }
    });

    // Action: Edit Rent Day (Step 1)
    bot.action(/admin_edit_rent_day_(\d+)_(\d+)/, async (ctx) => {
      const tenantId = parseInt(ctx.match[1]);
      const apartmentId = parseInt(ctx.match[2]);
      const sessionCtx = ctx as any;
      sessionCtx.session = sessionCtx.session || {};
      sessionCtx.session.state = 'admin_editing_rent_day';
      sessionCtx.session.editTenantId = tenantId;
      sessionCtx.session.editApartmentId = apartmentId;
      
      await ctx.editMessageText('Введите новый день оплаты (число от 1 до 31):', Markup.inlineKeyboard([]));
      await ctx.answerCbQuery();
    });

    // Action: Edit Rent Amount (Step 1)
    bot.action(/admin_edit_rent_amount_(\d+)_(\d+)/, async (ctx) => {
      const tenantId = parseInt(ctx.match[1]);
      const apartmentId = parseInt(ctx.match[2]);
      const sessionCtx = ctx as any;
      sessionCtx.session = sessionCtx.session || {};
      sessionCtx.session.state = 'admin_editing_rent_amount';
      sessionCtx.session.editTenantId = tenantId;
      sessionCtx.session.editApartmentId = apartmentId;
      
      await ctx.editMessageText('Введите новую сумму ежемесячной аренды:', Markup.inlineKeyboard([]));
      await ctx.answerCbQuery();
    });

    // Action: Edit Account Label (Step 1)
    bot.action(/admin_edit_acc_label_(\d+)_(\d+)/, async (ctx) => {
      const accountId = parseInt(ctx.match[1]);
      const apartmentId = parseInt(ctx.match[2]);
      const sessionCtx = ctx as any;
      sessionCtx.session = sessionCtx.session || {};
      sessionCtx.session.state = 'admin_editing_acc_label';
      sessionCtx.session.editAccountId = accountId;
      sessionCtx.session.editApartmentId = apartmentId;
      
      await ctx.editMessageText('Введите новое название для этого аккаунта (например, "Коммуналка" или "Офис"):', Markup.inlineKeyboard([]));
      await ctx.answerCbQuery();
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

        let allAccUsers: any[] = [];
        try {
          allAccUsers = await firstValueFrom(this.accountantClient.send('get_all_users', {}));
        } catch (e) {
          this.logger.warn('Could not fetch users from accountant for addresses');
        }

        const addressMap = new Map<string, string>();
        if (Array.isArray(allAccUsers)) {
          for (const accUser of allAccUsers) {
            const tgIdentity = accUser.identities?.find((i: any) => i.platform === 'telegram');
            const address = accUser.tenantProfile?.apartment?.address;
            if (tgIdentity && address) {
              addressMap.set(tgIdentity.externalId.toString(), address);
            }
          }
        }

        for (const u of users) {
           const roleStr = u.role === 'admin' ? '(Админ)' : '(Арендатор)';
           const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || 'Неизвестно';
           const isSuperAdmin = u.telegramId.toString() === config.SUPER_ADMIN_TELEGRAM_ID;

           const address = addressMap.get(u.telegramId.toString());
           const displayInfo = address ? `Квартира: ${address}` : `TG ID: ${u.telegramId}`;

           const buttons = [];
           if (!isSuperAdmin) {
             buttons.push(Markup.button.callback('❌ Удалить', `admin_delete_user_${u.id}`));
           }
           
           await ctx.reply(`👤 <b>${name}</b> ${roleStr}\n${displayInfo}`, {
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
