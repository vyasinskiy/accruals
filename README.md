# kvartplata-watcher

Pragmatic local-only backend for `kvartplata.online` built with **Node.js + TypeScript + NestJS structure + Playwright + Prisma + PostgreSQL**.

It keeps the important constraint intact: **login stays manual**. You open the real site once, solve captcha yourself if needed, and the backend reuses the saved authenticated session for internal API calls.

## What changed

The project is now split into two backend modules:

1. **Scraping module**
   - session-aware Playwright adapter
   - cron-triggered scheduled scan
   - manual HTTP endpoint to trigger a scan
   - uses a reusable apartment query service backed by Prisma instead of hardcoded object handling
   - preserves the discovered internal API approach:
     - `/new-web/apartments`
     - `/new-web/accruals`
     - `/new-web/utilities`
     - `/new-web/Accruals/invoice`

2. **API module**
   - DB-backed apartment/object endpoints
   - DB-backed accrual endpoints
   - DB-backed invoice/receipt metadata endpoints
   - Swagger/OpenAPI documentation

## Architecture

```text
src/
  main.ts                        # Nest bootstrap + Swagger
  app.module.ts
  common/
    prisma/                      # Prisma module/service
    services/apartments.service.ts
  modules/
    scraping/
      adapter.ts                 # Playwright + kvartplata internal API client
      scraping.service.ts        # cron/manual orchestration + persistence
      scraping.controller.ts     # POST /scraping/scan
    api/
      api.service.ts             # query layer
      api.controller.ts          # /api/* endpoints
  scripts/
    bootstrap.ts                 # manual login flow
    scan.ts                      # one-off local scan
prisma/schema.prisma             # apartments, accruals, invoices, runs
```

## Data model

Main Prisma entities:
- `Apartment` — local copy of apartment/object metadata
- `Accrual` — accrual rows from `/new-web/accruals`
- `Invoice` — invoice/receipt metadata from `/new-web/utilities` and `/new-web/Accruals/invoice`
- `Run` — scan execution history

## Install

```bash
cd /Users/torrnd/.openclaw/workspace/kvartplata-watcher
cp .env.example .env
npm install
npx playwright install chromium
```

## Start PostgreSQL

```bash
docker compose up -d postgres
npm run prisma:generate
npm run db:init
```

This project is intentionally optimized for local development. `prisma db push` is the fastest path here.

## Manual bootstrap flow

Do this first.

```bash
npm run bootstrap
```

Flow:
1. Browser opens in headed mode.
2. You log in manually at `kvartplata.online`.
3. If captcha appears, you solve it manually.
4. Return to terminal and press Enter.
5. Storage state is saved to `data/storage-state.json`.

If login still looks required, bootstrap fails on purpose. No fake automation, no captcha bypassing.

## Run the backend

```bash
npm run start
```

Default URLs:
- API: `http://localhost:3000`
- Swagger UI: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/docs-json`

## Cron + manual scan flow

### Scheduled scan

The scraping module registers a Nest cron job using `SCRAPE_CRON`.

Default:
```env
SCRAPE_CRON=0 9 * * *
TZ=America/Los_Angeles
```

Meaning: once a day at 09:00 local time the backend will try to reuse the saved Playwright session and scan the kvartplata internal APIs.

### Manual scan over HTTP

```bash
curl -X POST http://localhost:3000/scraping/scan \
  -H 'content-type: application/json' \
  -d '{}'
```

Optional filter example:

```bash
curl -X POST http://localhost:3000/scraping/scan \
  -H 'content-type: application/json' \
  -d '{"organization":"Краснодар","trigger":"manual"}'
```

Behavior:
- if DB already has apartments, the scraper uses the reusable DB query service to decide what to scan
- if DB is empty, it first loads apartments from `/new-web/apartments`
- then it queries accruals/invoice metadata through the discovered internal endpoints
- if session expired, the run is marked `needs_login`

## API examples

### Query apartments

List all apartments:

```bash
curl 'http://localhost:3000/api/apartments'
```

By address:

```bash
curl 'http://localhost:3000/api/apartments?address=Краснодар'
```

By organization:

```bash
curl 'http://localhost:3000/api/apartments?organization=УК'
```

One apartment with recent linked data:

```bash
curl 'http://localhost:3000/api/apartments/1'
```

### Query accruals

```bash
curl 'http://localhost:3000/api/accruals?apartmentExternalId=12345'
curl 'http://localhost:3000/api/accruals?periodLabel=2026-02'
```

### Query invoices / receipt metadata

```bash
curl 'http://localhost:3000/api/invoices?apartmentExternalId=12345'
curl 'http://localhost:3000/api/invoices?available=true'
```

### Recent scan history

```bash
curl 'http://localhost:3000/api/runs'
curl 'http://localhost:3000/scraping/runs'
```

## Useful commands

```bash
npm run bootstrap
npm run scan
npm run start
npm run build
npm run typecheck
npm run prisma:generate
npm run db:init
```

## Limitations / sharp edges

- This still depends on a valid manually created session. If the session expires, you must rerun `npm run bootstrap`.
- The exact JSON shape of kvartplata internal endpoints can vary. The scraper currently uses pragmatic field extraction heuristics instead of pretending the API is stable and documented.
- Invoice download remains best-effort and local-only.
- There is no captcha automation by design.
- No production deployment work was added. This is a local dev backend, as requested.

## Recommendation

The narrowest remaining risk is the exact response shape of the internal `kvartplata.online` endpoints for your account. Start with:

1. `npm run bootstrap`
2. `npm run start`
3. `POST /scraping/scan`
4. inspect Swagger + DB rows
5. tighten field mapping in `src/modules/scraping/adapter.ts` only if your account returns a weird payload
