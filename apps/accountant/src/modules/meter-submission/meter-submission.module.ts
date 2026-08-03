import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { MeterSubmissionService } from './meter-submission.service';
import { MeterSubmissionController } from './meter-submission.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { config } from '../../common/config/config';

@Module({
  imports: [
    PrismaModule,
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
  controllers: [MeterSubmissionController],
  providers: [MeterSubmissionService],
  exports: [MeterSubmissionService]
})
export class MeterSubmissionModule {}
