# Используем легкий образ Node.js
FROM node:22-slim

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем файлы манифестов
COPY package*.json ./
COPY prisma ./prisma/

# Устанавливаем только необходимые системные библиотеки (openssl для Prisma)
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Устанавливаем зависимости. 
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 запрещает скачивание браузеров внутрь этого образа.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install

# Копируем остальные файлы проекта
COPY . .

# Собираем TypeScript проект
RUN npm run build

# Команда для запуска
CMD npx prisma db push && npm run start
