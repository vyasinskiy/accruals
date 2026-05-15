import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { AdminInteractionService } from './admin-interaction.service';
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
  providers: [AdminInteractionService],
  exports: [AdminInteractionService],
})
export class AdminModule {}
