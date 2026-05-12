import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';

@Module({
  imports: [CommonModule],
  controllers: [ApiController],
  providers: [ApiService]
})
export class ApiModule {}
