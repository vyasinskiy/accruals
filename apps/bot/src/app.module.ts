import { Module } from '@nestjs/common';
import { BotModule } from './modules/bot/bot.module';

@Module({
  imports: [BotModule],
})
export class AppModule {}
