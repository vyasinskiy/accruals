# Accruals Management System

A microservices-based monorepo for managing utility accruals, tenant payments, and automated invoice tracking.

## Architecture Overview

The system consists of three main services communicating via RabbitMQ:

1.  **Accountant Service (`apps/accountant`)**:
    *   The core backend handling business logic and data persistence.
    *   Manages users, tenants, apartments, accounts, and accruals.
    *   Integrates with Prisma ORM and PostgreSQL.
    *   Handles S3 integration for storing payment receipts and invoices.

2.  **Telegram Bot Service (`apps/telegram-bot`)**:
    *   Telegram Bot interface for tenants and administrators.
    *   **Tenants**: Registration, payment submission (with photo receipts), debt status, and invoice viewing.
    *   **Admins**: User management (approval/deletion), payment confirmation, and apartment linking.

3.  **Watcher Service (`apps/watcher`)**:
    *   Automated scraper built with Playwright.
    *   Monitors external utility provider portals to fetch the latest accrual data and download invoice PDFs.
    *   Synchronizes data back to the Accountant service.

## Tech Stack

*   **Language**: TypeScript
*   **Backend Framework**: [NestJS](https://nestjs.com/)
*   **Database**: PostgreSQL with [Prisma](https://www.prisma.io/)
*   **Message Broker**: RabbitMQ
*   **Bot Framework**: [Telegraf](https://telegraf.js.org/)
*   **Browser Automation**: Playwright
*   **Storage**: AWS S3 / S3-compatible storage
*   **Containerization**: Docker & Docker Compose

## Project Structure

```text
.
├── apps/
│   ├── accountant/      # Core logic, DB, API
│   ├── telegram-bot/    # Telegram bot interface
│   └── watcher/         # Scraping and data synchronization
├── infra/               # Deployment and infrastructure config (Docker, Nginx)
└── package.json         # Root workspace configuration
```

## Getting Started

### Prerequisites

*   Node.js (v18+)
*   Docker & Docker Compose
*   Telegram Bot Token (from @BotFather)

### Setup

1.  Clone the repository.
2.  Install dependencies: `npm install`
3.  Set up environment variables in each app's directory (copy `.env.example` to `.env`).
4.  Start the infrastructure: `docker-compose -f infra/docker-compose.yml up -d`
5.  Run database migrations: `cd apps/accountant && npx prisma migrate dev`
6.  Start services in development mode: `npm run start:dev` (from respective app directories)

## Notification Routing & Publication Flow

The system implements a strictly decoupled notification architecture. The core **Accountant Service** handles business logic and has no knowledge of Telegram-specific fields, chat IDs, or HTML formatting rules. Routing and formatting are managed entirely on the **Telegram Bot Service** side.

### Flow Architecture

```mermaid
sequenceDiagram
    participant Accountant as Accountant Service
    participant Queue as RabbitMQ Event Bus
    participant Bot as Telegram Bot Service
    database BotDB as Bot Database
    participant Telegram as Telegram API

    Accountant->>Queue: emit 'accrual_upserted' / 'invoice_available' (tenant, apartment)
    Queue->>Bot: Consume event
    rect rgb(30, 41, 59)
        Note over Bot, BotDB: Resolve target channels
        Bot->>BotDB: Query User where tenantId = tenant.id
        BotDB-->>Bot: Return telegramId (Personal Chat)
        Bot->>BotDB: Query channels where type = 'feed'
        BotDB-->>Bot: Return feed channels (or fallback config)
    end
    loop for each targetChatId
        Bot->>BotDB: Check if invoice already published to channel
        alt Not published yet
            Bot->>Telegram: Send message (HTML notification)
            Bot->>BotDB: Log record in 'publications' table
        else Already published
            Bot->>Bot: Skip to prevent duplicate spam
        end
    end
```

### Key Components

1. **Decoupled Events**: Core services emit payload events containing only logical identifiers (e.g., `tenant: { id, status }`, `apartment: { id, address }`). No platform-specific values like `chatId` or raw Telegram markup are passed.
2. **Channel Resolution**:
   * **Personal Chat**: The bot looks up the tenant's `telegramId` using the local relation mapping (`tenantId` -> `telegramId`) in the bot's database.
   * **General Feeds**: The bot queries all registered publication channels with `type = "feed"` in the `publication_channels` table (with automatic fallback to the `TELEGRAM_CHAT_ID` environment variable).
3. **Deduplication & Logs (`publications` table)**:
   * To prevent duplicate spam in channels, the bot checks the `publications` table for any pre-existing combination of `[invoiceId, channelId]`.
   * Upon successful delivery, a log record is created in `publications` to track the delivery history.

### Managing Feed Channels

Administrator can dynamically register or unregister groups/channels as publication feeds directly from Telegram:

* **Add a Feed**: Add the bot to the desired group/channel and send `/register_feed` in the group/channel chat. The bot will validate that this is not a private chat, and automatically register the chat in the `publication_channels` table with `type: "feed"`.
* **Remove a Feed**: Send `/unregister_feed` inside the registered group/channel. The bot will remove it from the list of publication feeds.


