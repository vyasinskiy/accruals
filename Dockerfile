# Используем актуальный образ Playwright для 2026 года
FROM mcr.microsoft.com/playwright:v1.59.1-noble

# Устанавливаем рабочую директорию
WORKDIR /app

# Настраиваем системные переменные
ENV IS_DOCKER=true

# Копируем package.json (lock-файл не копируем, чтобы избежать конфликтов платформ)
COPY package.json ./

# Устанавливаем зависимости. 
# Фиксируем версию playwright и устанавливаем остальные пакеты.
RUN npm install playwright@1.59.1 && npm install

# Копируем остальные файлы
COPY . .

# Собираем TypeScript проект
RUN npm run build

# Команда для запуска
CMD npx prisma db push && npm run start
