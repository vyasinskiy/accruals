#!/bin/bash

# Останавливаем выполнение при любой ошибке
set -e

error_exit() {
    echo "❌ ERROR: $1"
    exit 1
}

echo "🚀 Starting deployment..."

# 1. Загружаем переменные из .env инфры
if [ -f .env ]; then
    echo "📝 Loading infrastructure .env..."
    set -a
    source .env
    set +a
fi

WATCHER_PATH=${WATCHER_PATH:-../accruals-watcher}
BOT_PATH=${BOT_PATH:-../accruals-bot}

# 2. Сборка образов
echo "📦 Building Watcher..."
docker build -t accruals-watcher:latest "${WATCHER_PATH}"
echo "📦 Building Bot..."
docker build -t accruals-bot:latest "${BOT_PATH}"

# 3. Запуск только Базы Данных для подготовки
echo "🏗️  Starting Database and RabbitMQ..."
WATCHER_PATH=$WATCHER_PATH BOT_PATH=$BOT_PATH docker compose up -d postgres rabbitmq

# 4. Ждем готовности базы (максимум 30 секунд)
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

# 5. Применяем миграции/схему БД
echo "🗄️  Syncing database schema..."
cd "${WATCHER_PATH}"
# Передаем DATABASE_URL для локального подключения к порту 5432
DATABASE_URL="postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD:-postgres}@localhost:5432/${POSTGRES_DB:-kvartplata_watcher}?schema=public" npx prisma db push
cd - > /dev/null

# 6. Запускаем всё остальное
echo "🚀 Starting application services..."
WATCHER_PATH=$WATCHER_PATH BOT_PATH=$BOT_PATH docker compose up -d

echo "✅ System is up and running!"
