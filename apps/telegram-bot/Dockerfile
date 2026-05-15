FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN mkdir -p node_modules/@prisma/client-telegram-bot/runtime
RUN npx prisma generate
RUN npm run build

CMD ["npm", "run", "start:prod"]
