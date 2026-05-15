import { Injectable, OnModuleInit } from '@nestjs/common';
import { Telegraf } from 'telegraf';
import { config } from '../../common/config/config';

@Injectable()
export class TelegramBotNotificationService implements OnModuleInit {
  private bot: Telegraf;

  onModuleInit() {
    this.bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);
  }

  async sendNotification(message: string, chatId?: string) {
    const targetChatId = chatId || config.TELEGRAM_CHAT_ID;
    if (!targetChatId) {
      console.error('No TELEGRAM_CHAT_ID provided');
      return;
    }
    await this.bot.telegram.sendMessage(targetChatId, message, { parse_mode: 'HTML' });
  }

  async sendAdminNotification(message: string, targetChatId: string, extra?: any) {
    await this.bot.telegram.sendMessage(targetChatId, message, {
      parse_mode: 'HTML',
      ...extra,
    });
  }

  async sendAdminPhotoNotification(photoId: string, caption: string, targetChatId: string, extra?: any) {
    await this.bot.telegram.sendPhoto(targetChatId, photoId, {
      caption,
      parse_mode: 'HTML',
      ...extra,
    });
  }
}
