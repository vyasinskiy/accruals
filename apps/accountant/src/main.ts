import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { config } from './common/config/config';
import { FileLogger } from './common/file-logger';

async function bootstrap() {
  const logger = new FileLogger('Accountant');
  const app = await NestFactory.create(AppModule, {
    logger,
  });

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [config.RABBITMQ_URL],
      queue: config.ACCOUNTANT_QUEUE,
      queueOptions: {
        durable: true,
      },
    },
  });

  await app.startAllMicroservices();
  await app.listen(config.PORT);
  
  logger.log(`Accountant HTTP API is listening on port ${config.PORT}`);
  logger.log('Accountant RMQ Microservice is listening...');
}
bootstrap();
