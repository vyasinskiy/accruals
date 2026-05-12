import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { config } from './config';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  const swagger = new DocumentBuilder()
    .setTitle('kvartplata-watcher API')
    .setDescription('Local backend for kvartplata.online session-based scraping, apartment lookup, accruals, and invoice metadata.')
    .setVersion('0.2.0')
    .build();

  const document = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup('docs', app, document);

  await app.listen(config.PORT);
  console.log(`kvartplata-watcher listening on http://localhost:${config.PORT}`);
  console.log(`Swagger UI: http://localhost:${config.PORT}/docs`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
