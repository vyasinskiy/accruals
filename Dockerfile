# Используем актуальный образ Playwright
FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app

ENV IS_DOCKER=true

COPY package.json ./

# Устанавливаем зависимости
RUN npm install playwright@1.59.1 && npm install

COPY . .

# Собираем TypeScript проект
RUN npm run build

# Генерируем клиент Prisma (это не требует подключения к БД)
RUN npx prisma generate

# Запускаем только приложение. 
# БД пушим через deploy.sh или вручную.
CMD ["npm", "run", "start"]
