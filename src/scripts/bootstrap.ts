import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ScrapingService } from '../modules/scraping/scraping.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(ScrapingService);
  await service.bootstrapSession();
  await app.close();
  console.log('Saved Playwright storage state.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
