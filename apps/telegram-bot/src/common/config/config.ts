import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  TELEGRAM_BOT_TOKEN: z.string(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  RABBITMQ_URL: z.string().default('amqp://localhost:5672'),
  QUEUE_NAME: z.string().default('accruals_notifications'),
  ACCOUNTANT_QUEUE: z.string().default('accountant_queue'),
  SUPER_ADMIN_TELEGRAM_ID: z.string().optional(),
  TZ: z.string().default('Europe/Madrid'),
});

const raw = schema.parse(process.env);

export const config = {
  ...raw,
};
