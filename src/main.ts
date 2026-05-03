import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { config } from './common/config/config';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
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
  console.log('Bot Microservice is listening...');
}
bootstrap();
