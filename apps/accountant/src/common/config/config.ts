import 'dotenv/config';
import { z } from 'zod';

const configSchema = z.object({
  PORT: z.coerce.number().int().default(3005),
  DATABASE_URL: z.string(),
  RABBITMQ_URL: z.string().default('amqp://localhost:5672'),
  ACCOUNTANT_QUEUE: z.string().default('accountant_queue'),
  S3_ENABLED: z.coerce.boolean().default(false),
  S3_BUCKET: z.string().default(''),
  S3_REGION: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_PREFIX: z.string().default(''),
  S3_SIGNED_URL_TTL: z.coerce.number().int().positive().default(3600),
  SUPER_ADMIN_TELEGRAM_ID: z.string().optional(),
});

const env = configSchema.parse(process.env);

export const config = {
  ...env,
};
