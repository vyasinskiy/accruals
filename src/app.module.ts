import { Module } from '@nestjs/common';
import { PrismaModule } from './common/prisma/prisma.module';
import { AccountantModule } from './modules/accountant/accountant.module';

@Module({
  imports: [PrismaModule, AccountantModule],
})
export class AppModule {}
