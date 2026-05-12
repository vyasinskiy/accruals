import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { AccountantClientService } from './services/accountant-client.service';
import { PrismaModule } from './prisma/prisma.module';
import { config } from '../config';

@Module({
  imports: [
    PrismaModule,
    ClientsModule.register([
      {
        name: 'NOTIFICATIONS_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: [config.RABBITMQ_URL],
          queue: config.QUEUE_NAME,
          queueOptions: {
            durable: true,
          },
        },
      },
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
  providers: [AccountantClientService],
  exports: [AccountantClientService, ClientsModule, PrismaModule],
})
export class CommonModule {}
