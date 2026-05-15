#!/bin/bash

# Stop execution on any error
set -e

error_exit() {
    echo "❌ ERROR: $1"
    exit 1
}

echo "🚀 Starting deployment..."

# 1. Load infrastructure variables from .env
if [ -f .env ]; then
    echo "📝 Loading infrastructure .env..."
    set -a
    source .env
    set +a
fi

WATCHER_PATH=${WATCHER_PATH:-../accruals-watcher}
ACCOUNTANT_PATH=${ACCOUNTANT_PATH:-../accruals-accountant}
TELEGRAM_BOT_PATH=${TELEGRAM_BOT_PATH:-../accruals-telegram-bot}

# 2. Build images
echo "📦 Building Watcher..."
docker build -t accruals-watcher:latest "${WATCHER_PATH}"
echo "📦 Building Accountant..."
docker build -t accruals-accountant:latest "${ACCOUNTANT_PATH}"
echo "📦 Building Telegram Bot..."
docker build -t accruals-telegram-bot:latest "${TELEGRAM_BOT_PATH}"

# 3. Start the infrastructure
echo "🏗️  Starting infrastructure services (Database, RabbitMQ)..."
WATCHER_PATH=$WATCHER_PATH ACCOUNTANT_PATH=$ACCOUNTANT_PATH TELEGRAM_BOT_PATH=$TELEGRAM_BOT_PATH docker compose up -d postgres rabbitmq

# 4. Wait for the database to be ready (maximum 30 seconds)
# This ensures services don't fail immediately on first start
echo "⏳ Waiting for PostgreSQL to be ready..."
MAX_RETRIES=30
COUNT=0
until docker exec accruals-postgres pg_isready -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-kvartplata_watcher} > /dev/null 2>&1 || [ $COUNT -eq $MAX_RETRIES ]; do
    sleep 1
    COUNT=$((COUNT + 1))
    echo -n "."
done
echo ""

if [ $COUNT -eq $MAX_RETRIES ]; then
    error_exit "PostgreSQL is not ready after 30 seconds."
fi

# 5. Start application services
# Migrations are handled internally by each service on startup
echo "🚀 Starting application services..."
WATCHER_PATH=$WATCHER_PATH ACCOUNTANT_PATH=$ACCOUNTANT_PATH TELEGRAM_BOT_PATH=$TELEGRAM_BOT_PATH docker compose up -d

echo "✅ System is up and running!"
