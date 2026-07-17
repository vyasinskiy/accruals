import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { config } from './config';
import { AppModule } from './app.module';
import { printSwaggerUrl } from './common/utils/swagger';
import { FileLogger } from './common/file-logger';

async function bootstrap(): Promise<void> {
  const logger = new FileLogger('Watcher');
  const app = await NestFactory.create(AppModule, {
    logger,
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [config.RABBITMQ_URL],
      queue: config.WATCHER_QUEUE,
      queueOptions: {
        durable: true,
      },
    },
  });

  const swagger = new DocumentBuilder()
    .setTitle('kvartplata-watcher API')
    .setDescription('Local backend for kvartplata.online session-based scraping, apartment lookup, accruals, and invoice metadata.')
    .setVersion('0.2.0')
    .build();

  const document = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup('docs', app, document);

  await app.startAllMicroservices();
  await app.listen(config.PORT);
  logger.log(`kvartplata-watcher listening on http://localhost:${config.PORT}`);
  logger.log('kvartplata-watcher RMQ microservice is listening...');
  printSwaggerUrl((msg) => logger.log(msg));
}

bootstrap().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error(msg);
  process.exit(1);
});
