import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { AccountantController } from './accountant.controller';
import { AccountantService } from './accountant.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { S3Module } from '../s3/s3.module';
import { config } from '../../common/config/config';

@Module({
  imports: [
    PrismaModule,
    S3Module,
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
  controllers: [AccountantController],
  providers: [AccountantService],
})
export class AccountantModule {}
