# kvartplata-watcher

Pragmatic Node.js + TypeScript watcher for `kvartplata.online`.

What it does:
- opens Playwright in **manual bootstrap mode** so a human can log in and solve captcha if needed
- saves and reuses browser session state (`storageState`)
- scans account/charges pages for receipt metadata
- stores runs, observations, and deduplicated receipts in **PostgreSQL via Prisma**
- sends Telegram alerts when new receipts appear
- sends Telegram alerts when the saved session is expired and manual re-login is needed

What it intentionally does **not** do:
- it does **not** automate captcha-protected login
- it does **not** promise perfect DOM selectors for a site that may change
- PDF download is optional and tracked separately from receipt metadata

## Project layout

- `src/adapter.ts` - Playwright adapter for kvartplata.online
- `src/app.ts` - bootstrap + scan orchestration
- `src/db.ts` - Prisma-backed persistence
- `src/telegram.ts` - Telegram notifications
- `src/cli.ts` - CLI commands
- `prisma/schema.prisma` - Prisma models
- `docker-compose.yml` - local PostgreSQL for development
- `.env.example` - configuration template

## Install

```bash
cd /Users/torrnd/.openclaw/workspace/kvartplata-watcher
cp .env.example .env
npm install
npx playwright install chromium
```

## Start PostgreSQL locally

```bash
docker compose up -d postgres
```

Default local database credentials in `docker-compose.yml` and `.env.example`:
- database: `kvartplata_watcher`
- user: `postgres`
- password: `postgres`
- port: `5432`

## Initialize Prisma / database schema

```bash
npm run prisma:generate
npm run db:init
```

If you prefer checked-in SQL migrations instead of schema push:

```bash
npm run prisma:migrate
```

`db:init` uses `prisma db push`, which is the fastest local bootstrap path. `prisma:migrate` applies the checked-in migration files.

## Configure

At minimum set these in `.env`:

```env
APP_URL=https://kvartplata.online/
LOGIN_URL=https://kvartplata.online/
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kvartplata_watcher?schema=public
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

Then tune selectors if the real site DOM differs from the defaults. The adapter is deliberately configurable because `kvartplata.online` may render different account pages for different управляющие компании or tenants.

Important selector/config knobs:
- `ACCOUNT_PAGE_URL`, `CHARGES_PAGE_URL`
- `ACCOUNT_CARD_SELECTOR`, `ACCOUNT_NAME_SELECTOR`, `ACCOUNT_ID_SELECTOR`, `ACCOUNT_LINK_SELECTOR`
- `ROW_SELECTOR`, `MONTH_SELECTOR`, `AMOUNT_SELECTOR`, `STATUS_SELECTOR`
- `RECEIPT_BUTTON_SELECTOR`
- `DOWNLOAD_RECEIPTS=true` if receipt PDF downloading is actually working for your account flow

## Bootstrap manual login

This is the required first step.

```bash
npm run bootstrap
```

Flow:
1. Chromium opens in headed mode.
2. You log in manually.
3. If captcha appears, you solve it manually.
4. Return to the terminal and press Enter.
5. The script checks whether login still looks required.
6. If login succeeded, it saves Playwright storage state to `STORAGE_STATE_PATH`.

If the site still shows login/captcha text, bootstrap fails on purpose instead of pretending the session is valid.

## Scan without notifying

```bash
npm run scan
```

This:
- reuses the saved storage state
- goes to the account page
- attempts to open the charges/receipts tab
- extracts current rows like month, amount, status, and receipt button presence
- stores every observation in PostgreSQL
- inserts new receipts only once based on a fingerprint derived from account + month + amount + status + receipt URL

## Scan and notify

```bash
npm run run
```

Behavior:
- if new receipts are detected, sends a Telegram summary
- if the session is expired or login is required, sends a Telegram alert saying manual bootstrap is needed
- if nothing changed, it stays quiet

## Local scheduler / cron

### Option A: cron at 9:00 local time

Use the OS cron scheduler. Example:

```cron
TZ=America/Los_Angeles
0 9 * * * cd /Users/torrnd/.openclaw/workspace/kvartplata-watcher && /opt/homebrew/bin/node ./node_modules/.bin/tsx src/cli.ts run >> ./data/cron.log 2>&1
```

On macOS you may prefer `launchd`, but cron is the simplest documented option.

### Option B: in-process scheduler

```bash
npm run scheduler
```

This keeps a local Node process alive and checks once per minute whether it is the configured target time.

Relevant env vars:

```env
SCHEDULE_HOUR=9
SCHEDULE_MINUTE=0
APP_TIMEZONE=America/Los_Angeles
```

## Prisma / PostgreSQL data model

Tables/models:
- `runs` - each scan attempt and its final status
- `receipts` - deduplicated receipt metadata, first seen / last seen
- `receipt_observations` - every observation event linked to a run and receipt

Receipt metadata is stored even if PDF download is unavailable. Fields include:
- account id
- month label
- amount text
- status text
- receipt button presence
- receipt URL if visible
- `receipt_downloaded` boolean

## Typical commands

```bash
docker compose up -d postgres
npm run prisma:generate
npm run db:init
npm run bootstrap
npm run scan
npm run run
npm run build
npm run typecheck
```

## Limitations / sharp edges

- `kvartplata.online` appears to be partly dynamic, so selectors may need adjustment per account layout.
- Session expiry detection is heuristic, based on page text keywords. If the site changes copy, update `.env` keywords.
- PDF download is best-effort only.
- If the site requires extra clicks or month selection widgets, extend `src/adapter.ts` for your exact account flow.
- I could not safely automate a real authenticated walkthrough here, so the default adapter is intentionally conservative and configurable.
- No automated SQLite-to-Postgres data migration is included. This change switches persistence going forward.

## Next practical step

Start Postgres, run Prisma init, run bootstrap once, then inspect the first `npm run scan` output and tweak selectors in `.env` or `src/adapter.ts` against the real DOM. That is the narrowest remaining risk.
