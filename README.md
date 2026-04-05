# kvartplata-watcher

Локальный backend для `квартплата.онлайн` на **NestJS + Prisma + PostgreSQL + Playwright**.

Главная цель: по сохранённой ручной сессии пройти реальный pipeline:

1. `GET /new-web/apartments` → получить все помещения
2. `GET /new-web/apartments/{apartmentId}/info` → получить все `accounts[]` для помещения
3. `GET /new-web/accruals?accountId=...` → получить начисления / периоды по каждому аккаунту
4. `GET /new-web/Accruals/invoice?AccountId=...&PeriodId=YYYYMM` → скачать PDF квитанции

## Важная модель данных

**У одного помещения может быть несколько аккаунтов.**

То есть фактическая схема такая:

- `apartmentId` = помещение
- `accountId` = лицевой счёт / договор внутри помещения
- квитанция ищется по связке:
  - `accountId`
  - `periodId` (`YYYYMM`)

В текущей реализации приложение хранит в таблице `apartments` уже **account-level записи**:
- `externalId` = `accountId`
- `parentApartmentId` хранится в `rawJson`
- адрес помещения и организация подтягиваются из apartment info

Это сделано специально, чтобы не ломать существующий API и при этом нормально поддержать **несколько аккаунтов на одну квартиру**.

## Что уже работает

- сервер стартует через `npm run start`
- Swagger доступен на `http://localhost:3000/docs`
- ручной scan доступен через `POST /scraping/scan`
- scan теперь идёт по цепочке:
  - apartments
  - apartment info
  - accounts
  - accruals
  - invoice
- в терминал добавлены **человекочитаемые логи** во время scan
- сохраняются данные по account-level сущностям, начислениям, квитанциям и запускам
- подтверждённый локальный кейс с account `7751294` и PDF за `202601`, `202602`, `202603` остаётся рабочим

## Ограничения

- login/captcha **не автоматизируются** — только ручной bootstrap и reuse сохранённой сессии
- upstream API может вести себя нестабильно, если сессия умерла или внутренние endpoint'ы поменялись
- если live path временно не даёт данных, приложение всё ещё может опираться на уже подтверждённый локальный dataset в `downloads/receipts_2026_summary.json`

## Путь проекта

```bash
cd /Users/torrnd/code/kvartplata-watcher
```

## Требования

- Node.js 24+
- локальный Postgres
- валидный `.env`
- при live scraping: сохранённая Playwright session state

## Базовые команды

### Установка

```bash
npm install
```

### Prisma client

```bash
npm run prisma:generate
```

### Инициализация схемы БД

```bash
npm run db:init
```

### Запуск сервера

```bash
npm run start
```

После запуска:

- Swagger: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/docs-json`

## Bootstrap сессии

Если сессия отсутствует или умерла:

```bash
npm run bootstrap
```

Что происходит:
- открывается браузер
- ты логинишься вручную
- проходишь капчу вручную
- сессия сохраняется в `data/storage-state.json`

## Как запустить scraping

Есть 2 пути.

### Вариант 1 — через CLI

```bash
npm run scan
```

### Вариант 2 — через API

Сначала запускаешь сервер:

```bash
npm run start
```

Потом вызываешь scan:

```bash
curl -X POST http://localhost:3000/scraping/scan \
  -H 'content-type: application/json' \
  -d '{}'
```

## Какие логи теперь идут в терминал

Во время scan теперь печатается нормальный человекочитаемый прогресс. Примеры:

- `Run started`
- `Apartments discovered from /new-web/apartments: 5`
- `Apartments selected for scan: 5`
- `Apartment found: 301174 | г Краснодар, ул Старокубанская, д 129, пом. 554`
- `Accounts found for apartment 301174: 2`
- `Scanning account 464653 for apartment 301174`
- `Accrual periods found for account 464653: 12`
- `Invoice downloaded for account 464653, period 202603`
- `Invoice missing for account 464653, period 202604`
- `Scan summary: apartments=5, accounts=7, accruals=40, invoices=40, downloaded=12, skipped=28`

То есть теперь по логу видно:
- сколько помещений найдено
- сколько аккаунтов у каждого помещения
- какие аккаунты реально сканируются
- сколько периодов найдено
- где PDF скачался, а где его нет
- финальную сводку

## Полезные endpoint'ы

### Scraping

- `POST /scraping/scan`
- `GET /scraping/runs`

### Data API

- `GET /api/apartments`
- `GET /api/apartments/:id`
- `GET /api/accruals`
- `GET /api/invoices`
- `GET /api/runs`

### Квитанция по периоду

Метаданные:

```bash
curl 'http://localhost:3000/api/invoices/by-period?apartmentExternalId=7751294&period=202603'
```

Скачать PDF:

```bash
curl -L 'http://localhost:3000/api/invoices/by-period/download?apartmentExternalId=7751294&period=202603' -o receipt_202603.pdf
```

## Реальная цепочка internal API

Вот тот flow, который теперь зашит в scraper:

### 1. Получить помещения

```http
GET /new-web/apartments
```

Пример ответа даёт `apartmentId`, `address` и прочие поля помещения.

### 2. Получить аккаунты конкретного помещения

```http
GET /new-web/apartments/{apartmentId}/info
```

Пример:

```http
GET /new-web/apartments/301174/info
```

В ответе приходит массив:

```json
{
  "accounts": [
    { "id": 464653, "serviceName": "Коммунальные и жилищные услуги" },
    { "id": 464746, "serviceName": "Коммунальные и жилищные услуги" }
  ]
}
```

### 3. Получить начисления по accountId

```http
GET /new-web/accruals?accountId=464653
```

Отсюда берутся:
- периоды
- суммы
- признаки начислений / платежей
- `periodId`

### 4. Скачать PDF квитанции

```http
GET /new-web/Accruals/invoice?AccountId=464653&PeriodId=202603
```

## Smoke test

После запуска сервера можно быстро проверить так:

```bash
curl http://localhost:3000/docs-json
curl -X POST http://localhost:3000/scraping/scan -H 'content-type: application/json' -d '{}'
curl 'http://localhost:3000/api/apartments'
curl 'http://localhost:3000/api/invoices'
curl 'http://localhost:3000/api/invoices/by-period?apartmentExternalId=7751294&period=202603'
```

## Что изменено по сравнению со старой логикой

Старая логика пыталась идти слишком грубо и фактически предполагала почти `apartment -> accruals/invoice` напрямую.

Новая логика теперь правильная:

- сначала берём **все помещения**
- потом для каждого помещения берём **все аккаунты**
- дальше скан идёт уже по **accountId**
- invoice качается строго по:
  - `AccountId`
  - `PeriodId`

Это и есть правильная модель для кейса, где у одного помещения несколько лицевых счетов.
