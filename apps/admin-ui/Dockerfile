FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json .
COPY tsconfig.json .
COPY next.config.js .
COPY .env.example .
COPY . .
RUN npm install && npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.next ./.next

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 6000
CMD ["npm", "run", "start"]
