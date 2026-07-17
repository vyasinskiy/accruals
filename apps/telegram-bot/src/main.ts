import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { config } from './common/config/config';
import { FileLogger } from './common/file-logger';

async function bootstrap() {
  const logger = new FileLogger('TelegramBot');
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    logger,
    transport: Transport.RMQ,
    options: {
      urls: [config.RABBITMQ_URL],
      queue: config.QUEUE_NAME,
      queueOptions: {
        durable: true,
      },
    },
  });
  await app.listen();
  logger.log('Telegram Bot Microservice is listening...');
}
bootstrap();
