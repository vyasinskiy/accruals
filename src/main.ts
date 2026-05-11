import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { config } from './common/config/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
  
  console.log(`Accountant HTTP API is listening on port ${config.PORT}`);
  console.log('Accountant RMQ Microservice is listening...');
}
bootstrap();
