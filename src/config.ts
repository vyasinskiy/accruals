import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  TZ: z.string().default('America/Los_Angeles'),
  APP_URL: z.string().url().default('https://kvartplata.online/'),
  APP_TIMEZONE: z.string().default('America/Los_Angeles'),
  DATA_DIR: z.string().default('./data'),
  STORAGE_STATE_PATH: z.string().default('./data/storage-state.json'),
  DATABASE_URL: z.string().min(1).default('postgresql://postgres:postgres@localhost:5432/kvartplata_watcher?schema=public'),
  HEADLESS: z.coerce.boolean().default(true),
  LOG_LEVEL: z.string().default('info'),
  LOGIN_URL: z.string().url().default('https://kvartplata.online/'),
  LOGIN_REQUIRED_TEXT: z.string().default('Войти,Авторизация,Капча,CAPTCHA,Личный кабинет'),
  ACCOUNT_READY_TEXT: z.string().default('Начисления,Квитанция,Лицевой счет,Личный кабинет'),
  SESSION_REQUIRED_KEYWORDS: z.string().default('войти,авторизация,captcha,капча'),
  ACCOUNT_PAGE_URL: z.string().optional().default(''),
  CHARGES_PAGE_URL: z.string().optional().default(''),
  CHARGES_TAB_SELECTOR: z.string().default('text=/Начисления|Платежи|Квитанции/i'),
  ACCOUNT_CARD_SELECTOR: z.string().default('[data-account], .account-card, .abonent-item, .ls-item'),
  ACCOUNT_NAME_SELECTOR: z.string().default('.account-card__title, .account-name, .abonent-item__title, .title'),
  ACCOUNT_ID_SELECTOR: z.string().default('.account-card__number, .ls-number, .account-number, .subtitle'),
  ACCOUNT_LINK_SELECTOR: z.string().default('a'),
  ROW_SELECTOR: z.string().default('table tbody tr, .charges-table tbody tr, .receipt-row, .payment-row'),
  MONTH_SELECTOR: z.string().default('[data-month], .month, td:nth-child(1)'),
  AMOUNT_SELECTOR: z.string().default('[data-amount], .amount, td:nth-child(2)'),
  STATUS_SELECTOR: z.string().default('[data-status], .status, td:nth-child(3)'),
  RECEIPT_BUTTON_SELECTOR: z.string().default('a:has-text("Квитанция"), button:has-text("Квитанция"), [title*="Квитанц"]'),
  NEXT_PAGE_SELECTOR: z.string().optional().default(''),
  WAIT_AFTER_LOGIN_MS: z.coerce.number().default(3000),
  WAIT_AFTER_NAV_MS: z.coerce.number().default(1500),
  DOWNLOAD_RECEIPTS: z.coerce.boolean().default(false),
  RECEIPT_DOWNLOAD_DIR: z.string().default('./data/receipts'),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  TELEGRAM_SILENT: z.coerce.boolean().default(false),
  SCHEDULE_ENABLED: z.coerce.boolean().default(false),
  SCHEDULE_HOUR: z.coerce.number().int().min(0).max(23).default(9),
  SCHEDULE_MINUTE: z.coerce.number().int().min(0).max(59).default(0)
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
  loginRequiredTextList: splitCsv(raw.LOGIN_REQUIRED_TEXT),
  accountReadyTextList: splitCsv(raw.ACCOUNT_READY_TEXT),
  sessionRequiredKeywords: splitCsv(raw.SESSION_REQUIRED_KEYWORDS).map((x) => x.toLowerCase())
};

for (const dir of [config.dataDir, path.dirname(config.storageStatePath), config.receiptDownloadDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

function splitCsv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
