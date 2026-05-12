import { Module } from '@nestjs/common';
import { PrismaModule } from './common/prisma/prisma.module';
import { AccountantModule } from './modules/accountant/accountant.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [PrismaModule, AccountantModule, TenantModule, UsersModule],
})
export class AppModule {}

