import { bootstrapSession, runScan } from './app';
import { AppDb } from './db';
import { config } from './config';

async function main(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    case 'bootstrap':
      await bootstrapSession();
      console.log(`Saved storage state to ${config.storageStatePath}`);
      break;
    case 'scan': {
      const summary = await runScan(false);
      console.log(JSON.stringify(summary, null, 2));
      break;
    }
    case 'notify':
    case 'run': {
      const summary = await runScan(true);
      console.log(JSON.stringify(summary, null, 2));
      break;
    }
    case 'scheduler':
      await runScheduler();
      break;
    case 'db:init': {
      const db = new AppDb();
      await db.close();
      console.log('Database initialized. Run `npm run prisma:generate` and `npm run db:init` after Postgres is up.');
      break;
    }
    default:
      printHelp();
      process.exitCode = 1;
  }
}

async function runScheduler(): Promise<void> {
  console.log(`Scheduler active. Will run daily at ${pad(config.SCHEDULE_HOUR)}:${pad(config.SCHEDULE_MINUTE)} ${config.APP_TIMEZONE}.`);
  let lastKey = '';

  const tick = async () => {
    const now = new Date();
    const key = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    if (now.getHours() === config.SCHEDULE_HOUR && now.getMinutes() === config.SCHEDULE_MINUTE && key !== lastKey) {
      lastKey = key;
      try {
        const summary = await runScan(true);
        console.log(`[scheduler] ${summary.message}`);
      } catch (error) {
        console.error('[scheduler] scan failed', error);
      }
    }
  };

  await tick();
  setInterval(() => void tick(), 60_000);
}

function printHelp(): void {
  console.log(`Usage:
  npm run bootstrap         # open browser, log in manually, save storage state
  npm run scan              # reuse saved session, scan accounts, persist results
  npm run run               # scan + send Telegram notifications for new receipts / login required
  npm run scheduler         # local in-process scheduler (checks every minute)
  npm run prisma:generate   # generate Prisma client
  npm run db:init           # push Prisma schema to PostgreSQL
  npm run prisma:migrate    # apply checked-in Prisma migrations`);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
