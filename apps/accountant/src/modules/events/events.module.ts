import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { S3Module } from '../s3/s3.module';
import { MeterSubmissionModule } from '../meter-submission/meter-submission.module';
import { config } from '../../common/config/config';

@Module({
  imports: [
    PrismaModule,
    S3Module,
    MeterSubmissionModule,
    ClientsModule.register([
      {
        name: 'NOTIFICATIONS_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: [config.RABBITMQ_URL],
          queue: process.env.QUEUE_NAME || 'accruals_notifications',
          queueOptions: {
            durable: true,
          },
        },
      },
    ]),
  ],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
