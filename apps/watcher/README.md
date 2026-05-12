# kvartplata-watcher

Local backend for `kvartplata.online` built with **NestJS + Prisma + PostgreSQL + Playwright**.

The main goal is to follow the real pipeline using a saved manual session:

1. `GET /new-web/apartments` → get all premises
2. `GET /new-web/apartments/{apartmentId}/info` → get all `accounts[]` for the premise
3. `GET /new-web/accruals?accountId=...` → get accruals/periods for each account
4. `GET /new-web/Accruals/invoice?AccountId=...&PeriodId=YYYYMM` → download invoice PDFs

## Important Data Model

**One apartment/premise can have multiple accounts.**

The actual schema is as follows:

- `apartmentId` = the physical premise
- `accountId` = the personal account / contract within the premise
- An invoice is identified by the combination of:
  - `accountId`
  - `periodId` (`YYYYMM`)

In the current implementation, the application stores **account-level records** in the `apartments` table:
- `externalId` = `accountId`
- `parentApartmentId` is stored in `rawJson`
- The premise address and organization are pulled from the apartment info

This approach is intentional to maintain compatibility with the existing API while properly supporting **multiple accounts per apartment**.

## Current Features

- Server starts via `npm run start`
- Swagger UI available at `http://localhost:3000/docs`
- Manual scan available via `POST /scraping/scan`
- The scan follows the full chain:
  - apartments
  - apartment info
  - accounts
  - accruals
  - invoice
- **Human-readable logs** added to the terminal during the scan
- Data is stored for account-level entities, accruals, invoices, and runs
- Confirmed local case with account `7751294` and PDFs for `202601`, `202602`, `202603` remains functional

## Limitations

- Login/captcha are **not automated** — only manual bootstrap and session reuse
- Upstream API may be unstable if the session expires or internal endpoints change
- If the live path is temporarily unavailable, the app can still rely on the confirmed local dataset in `downloads/receipts_2026_summary.json`

## Requirements

- Node.js 24+
- Docker (for running the database)
- Valid `.env` file (create from `.env.example`)
- For live scraping: a saved Playwright session state

## Quick Start (Local)

### 1. Environment Setup

```bash
cp .env.example .env
# Edit .env: specify DATABASE_URL, DIRECT_URL, and PLAYWRIGHT_BROWSERS_PATH
```

### 2. Start the Database

The project uses PostgreSQL. The easiest way is to run it via Docker:

```bash
docker-compose up -d
```

### 3. Install Dependencies and Browser

```bash
npm install
# Install Chromium browser locally in the project folder (configured via .env)
npm run playwright:install
```

### 4. Initialize the Database

```bash
npm run db:init
```

### 5. Authorization (Bootstrap)

If the session is missing or expired, you need to log in manually:

```bash
npm run bootstrap
```

### 6. Start the Server or Scan

```bash
npm run start:dev  # Start the development server
# or
npm run scan       # One-time accruals scan
```

## Basic Commands

After startup:

- Swagger: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/docs-json`

## Session Bootstrap

If the session is missing or has expired:

```bash
npm run bootstrap
```

What happens:
- A browser window opens
- You log in manually
- You solve the captcha manually
- The session is saved to `data/storage-state.json`

## How to Run Scraping

There are 2 ways.

### Option 1 — via CLI

```bash
npm run scan
```

### Option 2 — via API

First, start the server:

```bash
npm run start
```

Then trigger the scan:

```bash
curl -X POST http://localhost:3000/scraping/scan \
  -H 'content-type: application/json' \
  -d '{}'
```

## Scan Logs Examples

During the scan, a clean progress log is printed to the terminal. Examples:

- `Run started`
- `Apartments discovered from /new-web/apartments: 5`
- `Apartments selected for scan: 5`
- `Apartment found: 301174 | Krasnodar, Starokubanskaya st, 129, apt. 554`
- `Accounts found for apartment 301174: 2`
- `Scanning account 464653 for apartment 301174`
- `Accrual periods found for account 464653: 12`
- `Invoice downloaded for account 464653, period 202603`
- `Invoice missing for account 464653, period 202604`
- `Scan summary: apartments=5, accounts=7, accruals=40, invoices=40, downloaded=12, skipped=28`

The log clearly shows:
- How many premises were found
- How many accounts each premise has
- Which accounts are actually being scanned
- How many periods were discovered
- Where the PDF was downloaded vs. where it is missing
- Final summary

## Useful Endpoints

### Scraping

- `POST /scraping/scan`
- `GET /scraping/runs`

### Data API

- `GET /api/apartments`
- `GET /api/apartments/:id`
- `GET /api/accruals`
- `GET /api/invoices`
- `GET /api/runs`

### Fetch Invoice by Period

Metadata:

```bash
curl 'http://localhost:3000/api/invoices/by-period?apartmentExternalId=7751294&period=202603'
```

Download PDF:

```bash
curl -L 'http://localhost:3000/api/invoices/by-period/download?apartmentExternalId=7751294&period=202603' -o receipt_202603.pdf
```

## Internal API Chain

The scraper follows this specific flow:

### 1. Get Premises

```http
GET /new-web/apartments
```

The response provides `apartmentId`, `address`, and other fields for the premise.

### 2. Get Accounts for a Specific Premise

```http
GET /new-web/apartments/{apartmentId}/info
```

Example:

```http
GET /new-web/apartments/301174/info
```

Response array:

```json
{
  "accounts": [
    { "id": 464653, "serviceName": "Utilities and housing services" },
    { "id": 464746, "serviceName": "Utilities and housing services" }
  ]
}
```

### 3. Get Accruals by accountId

```http
GET /new-web/accruals?accountId=464653
```

This retrieves:
- periods
- amounts
- accrual/payment status
- `periodId`

### 4. Download Invoice PDF

```http
GET /new-web/Accruals/invoice?AccountId=464653&PeriodId=202603
```

## Smoke Test

Once the server is running, you can quickly verify it:

```bash
curl http://localhost:3000/docs-json
curl -X POST http://localhost:3000/scraping/scan -H 'content-type: application/json' -d '{}'
curl 'http://localhost:3000/api/apartments'
curl 'http://localhost:3000/api/invoices'
curl 'http://localhost:3000/api/invoices/by-period?apartmentExternalId=7751294&period=202603'
```

## Logic Improvements

Previous logic was too simplified and assumed an almost direct `apartment -> accruals/invoice` mapping.

The new logic is more accurate:

- First, fetch **all premises**
- Then, for each premise, fetch **all associated accounts**
- Proceed with the scan using the **accountId**
- Download invoices strictly by:
  - `AccountId`
  - `PeriodId`

This correctly handles cases where a single apartment has multiple utility accounts.
