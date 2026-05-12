import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { TenantController } from './tenant.controller';
import { TenantRegistrationService } from './tenant-registration.service';
import { TenantPaymentService } from './tenant-payment.service';
import { TenantInvoiceService } from './tenant-invoice.service';
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
  controllers: [TenantController],
  providers: [
    TenantRegistrationService,
    TenantPaymentService,
    TenantInvoiceService
  ],
})
export class TenantModule {}
