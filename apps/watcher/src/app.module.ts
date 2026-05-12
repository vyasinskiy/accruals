import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonModule } from './common/common.module';
import { config } from './config';
import { ApiModule } from './modules/api/api.module';
import { ScrapingModule } from './modules/scraping/scraping.module';

@Module({
  imports: [ScheduleModule.forRoot(), CommonModule, ApiModule, ScrapingModule],
  providers: [
    {
      provide: 'APP_CONFIG',
      useValue: config
    }
  ]
})
export class AppModule {}
