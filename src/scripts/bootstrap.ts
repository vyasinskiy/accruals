import { ScrapingService } from '../modules/scraping/scraping.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { ApartmentsService } from '../common/services/apartments.service';

async function main(): Promise<void> {
  const prisma = new PrismaService();
  await prisma.$connect();
  const service = new ScrapingService(prisma, new ApartmentsService(prisma));
  await service.bootstrapSession();
  await prisma.$disconnect();
  console.log('Saved Playwright storage state.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
