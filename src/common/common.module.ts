import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { PrismaModule } from './prisma/prisma.module';
import { ApartmentsService } from './services/apartments.service';
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
    ]),
  ],
  providers: [ApartmentsService],
  exports: [PrismaModule, ApartmentsService, ClientsModule],
})
export class CommonModule {}
