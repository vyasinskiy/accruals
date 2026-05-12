import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module';
import { ScrapingController } from './scraping.controller';
import { ScrapingService } from './scraping.service';

@Module({
  imports: [CommonModule],
  controllers: [ScrapingController],
  providers: [ScrapingService],
  exports: [ScrapingService]
})
export class ScrapingModule {}
