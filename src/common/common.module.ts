import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { ApartmentsService } from './services/apartments.service';

@Module({
  imports: [PrismaModule],
  providers: [ApartmentsService],
  exports: [PrismaModule, ApartmentsService]
})
export class CommonModule {}
