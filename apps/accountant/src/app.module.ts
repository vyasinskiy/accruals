import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './common/prisma/prisma.module';
import { AccountantModule } from './modules/accountant/accountant.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { UsersModule } from './modules/users/users.module';
import { MeterEventModule } from './modules/meter-event/meter-event.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule, 
    AccountantModule, 
    TenantModule, 
    UsersModule,
    MeterEventModule
  ],
})
export class AppModule {}

