import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_URL: z.string().url().default('https://kvartplata.online/'),
  LOGIN_URL: z.string().url().default('https://kvartplata.online/'),
  ACCOUNT_PAGE_URL: z.string().optional().default('https://kvartplata.online/new-web/apartments'),
  API_BASE_URL: z.string().url().default('https://kvartplata.online'),
  DATA_DIR: z.string().default('./data'),
  STORAGE_STATE_PATH: z.string().default('./data/storage-state.json'),
  DATABASE_URL: z.string().min(1).default('postgresql://postgres:postgres@localhost:5432/kvartplata_watcher?schema=public'),
  HEADLESS: z.coerce.boolean().default(true),
  WAIT_AFTER_LOGIN_MS: z.coerce.number().default(3000),
  WAIT_AFTER_NAV_MS: z.coerce.number().default(1500),
  SESSION_REQUIRED_KEYWORDS: z.string().default('войти,авторизация,captcha,капча'),
  ACCOUNT_READY_TEXT: z.string().default('Начисления,Квитанция,Лицевой счет,Личный кабинет'),
  DOWNLOAD_RECEIPTS: z.coerce.boolean().default(false),
  RECEIPT_DOWNLOAD_DIR: z.string().default('./data/receipts'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  TELEGRAM_SILENT: z.coerce.boolean().default(false),
  SCRAPE_CRON: z.string().default('0 9 * * *'),
  TZ: z.string().default('America/Los_Angeles')
});

const raw = schema.parse(process.env);
const rootDir = process.cwd();
const resolvePath = (value: string) => path.resolve(rootDir, value);

export const config = {
  ...raw,
  rootDir,
  dataDir: resolvePath(raw.DATA_DIR),
  storageStatePath: resolvePath(raw.STORAGE_STATE_PATH),
  receiptDownloadDir: resolvePath(raw.RECEIPT_DOWNLOAD_DIR),
  sessionRequiredKeywords: splitCsv(raw.SESSION_REQUIRED_KEYWORDS).map((x) => x.toLowerCase()),
  accountReadyTextList: splitCsv(raw.ACCOUNT_READY_TEXT),
  endpoints: {
    apartments: '/new-web/apartments',
    accruals: '/new-web/accruals',
    utilities: '/new-web/utilities',
    invoice: '/new-web/Accruals/invoice'
  }
};

for (const dir of [config.dataDir, path.dirname(config.storageStatePath), config.receiptDownloadDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

function splitCsv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
