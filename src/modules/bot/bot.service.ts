import { Injectable, OnModuleInit } from '@nestjs/common';
import { Telegraf } from 'telegraf';
import { config } from '../../common/config/config';

@Injectable()
export class BotService implements OnModuleInit {
  private bot: Telegraf;

  onModuleInit() {
    this.bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);
    this.bot.launch().catch(err => {
      console.error('Failed to launch Telegram bot', err);
    });
  }

  async sendNotification(message: string, chatId?: string) {
    const targetChatId = chatId || config.TELEGRAM_CHAT_ID;
    if (!targetChatId) {
      console.error('No TELEGRAM_CHAT_ID provided');
      return;
    }
    await this.bot.telegram.sendMessage(targetChatId, message, { parse_mode: 'HTML' });
  }
}
