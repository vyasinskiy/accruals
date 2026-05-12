import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { BotController } from './bot.controller';
import { BotNotificationService } from './bot-notification.service';
import { BotInteractionService } from './bot-interaction.service';
import { config } from '../../common/config/config';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'ACCOUNTANT_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: [config.RABBITMQ_URL],
          queue: config.ACCOUNTANT_QUEUE,
          queueOptions: {
            durable: true,
          },
        },
      },
    ]),
  ],
  providers: [BotNotificationService, BotInteractionService],
  controllers: [BotController],
  exports: [BotNotificationService],
})
export class BotModule {}
