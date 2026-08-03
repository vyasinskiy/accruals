import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './common/prisma/prisma.module';
import { AccountantModule } from './modules/accountant/accountant.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { UsersModule } from './modules/users/users.module';
import { MeterSubmissionModule } from './modules/meter-submission/meter-submission.module';
import { EventsModule } from './modules/events/events.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule, 
    AccountantModule, 
    TenantModule, 
    UsersModule,
    MeterSubmissionModule,
    EventsModule
  ],
})
export class AppModule {}

