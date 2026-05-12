import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ScrapingService } from '../modules/scraping/scraping.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(ScrapingService);
  const summary = await service.scan({ trigger: 'manual' });
  await app.close();
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
