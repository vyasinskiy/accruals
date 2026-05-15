# Use the latest Playwright image
FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app

ENV IS_DOCKER=true

COPY package.json ./

# Install dependencies
RUN npm install playwright@1.59.1 && npm install

COPY . .
RUN mkdir -p node_modules/@prisma/client-watcher/runtime
# Generate Prisma Client (does not require DB connection)
# Must be BEFORE npm run build for tsc to see correct types
RUN npx prisma generate

# Build TypeScript project
RUN npm run build

# Start the application.
# DB is pushed via deploy.sh or manually.
CMD ["npm", "run", "start"]
