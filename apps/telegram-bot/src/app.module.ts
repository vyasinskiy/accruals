import { Module } from '@nestjs/common';
import { TelegramBotModule } from './modules/telegram-bot/telegram-bot.module';
import { PrismaModule } from './common/prisma/prisma.module';

@Module({
  imports: [PrismaModule, TelegramBotModule],
})
export class AppModule {}
