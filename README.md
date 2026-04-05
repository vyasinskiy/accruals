# kvartplata-watcher

Local NestJS + Prisma + Postgres + Playwright app for **manual-session** kvartplata scraping.

## Blunt status

### Fully working now

- `npm run start` starts without Swagger crashing.
- Swagger UI works at `http://localhost:3000/docs`.
- Postgres-backed API works for apartments, accruals, invoices, and run history.
- `POST /scraping/scan` persists data into Postgres.
- The **confirmed real case** is wired through the app: account/apartment `7751294` with invoice PDFs for `202601`, `202602`, `202603`.
- Invoice lookup/download works through the API:
  - metadata: `GET /api/invoices/by-period?apartmentExternalId=7751294&period=202603`
  - PDF stream: `GET /api/invoices/by-period/download?apartmentExternalId=7751294&period=202603`

### Still limited / honest caveats

- The upstream internal endpoint currently configured in the adapter returns `404` for `/new-web/apartments` in this environment.
- Because of that, **generic multi-apartment discovery is not fully solved yet**.
- The app does **not** fake that away: manual scans still try the real Playwright/session-based path first, but also import the already-confirmed local receipt dataset so the known working apartment/account is usable end-to-end right now.
- No captcha bypass was added. Session bootstrap is still manual by design.

## Stack kept intact

- NestJS
- Prisma
- PostgreSQL
- Playwright
- Swagger

## Requirements

- Node 24+
- PostgreSQL running locally and reachable by `DATABASE_URL`
- A valid Playwright storage state for manual-session mode if you want to keep probing the live site

## Environment

Copy and adjust `.env` if needed. Current project expects local Postgres like:

```env
DATABASE_URL=postgresql://torrnd@localhost:5432/kvartplata_watcher?schema=public
```

Important paths already used by the app:

- storage state: `./data/storage-state.json`
- confirmed local receipts: `./downloads/receipts_2026_summary.json`
- confirmed PDFs:
  - `./downloads/receipt_7751294_202601.pdf`
  - `./downloads/receipt_7751294_202602.pdf`
  - `./downloads/receipt_7751294_202603.pdf`

## Exact local run commands

Install deps:

```bash
npm install
```

Generate Prisma client and sync schema:

```bash
npm run prisma:generate
npm run db:init
```

Start the app:

```bash
npm run start
```

The start script builds TypeScript and runs the compiled server from `dist/`.

## Manual session bootstrap

If your kvartplata session is expired or missing, bootstrap it manually:

```bash
npm run bootstrap
```

That opens Playwright, lets you log in manually, and saves session state to `data/storage-state.json`.

## Manual scan

Trigger a scan through the API:

```bash
curl -X POST http://localhost:3000/scraping/scan \
  -H 'content-type: application/json' \
  -d '{}'
```

Expected practical result right now:

- it attempts the live session/internal API path
- if that path still fails with the current `404`, it still imports the confirmed local receipts for account `7751294`
- data is persisted into Postgres tables: `apartments`, `accruals`, `invoices`, `runs`

## Useful endpoints

### Swagger

- `GET /docs`
- `GET /docs-json`

### Scraping

- `POST /scraping/scan`
- `GET /scraping/runs`

### Data API

- `GET /api/apartments`
- `GET /api/apartments/:id`
- `GET /api/accruals`
- `GET /api/invoices`
- `GET /api/runs`

### Invoice lookup / download

Get invoice metadata by apartment/account + period:

```bash
curl 'http://localhost:3000/api/invoices/by-period?apartmentExternalId=7751294&period=202603'
```

Download/stream the PDF:

```bash
curl -OJ 'http://localhost:3000/api/invoices/by-period/download?apartmentExternalId=7751294&period=202603'
```

## Quick smoke test

After `npm run start`, these should work:

```bash
curl http://localhost:3000/docs-json
curl -X POST http://localhost:3000/scraping/scan -H 'content-type: application/json' -d '{}'
curl 'http://localhost:3000/api/apartments?externalId=7751294'
curl 'http://localhost:3000/api/invoices/by-period?apartmentExternalId=7751294&period=202603'
curl -I 'http://localhost:3000/api/invoices/by-period/download?apartmentExternalId=7751294&period=202603'
```

## Notes on data model

The current DB schema stores:

- `apartments` — apartment/account entities
- `accruals` — period-level accrual snapshots
- `invoices` — invoice metadata and local PDF path when available
- `runs` — scan history / summary

Legacy tables from the earlier partial version were preserved in Prisma compatibility mode so the local DB could be upgraded non-destructively.
