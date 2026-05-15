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
