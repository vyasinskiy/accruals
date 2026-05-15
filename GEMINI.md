# Project Instructions & Conventions

## Architecture & Design Patterns

### Notification Decoupling
- **Mandatory**: Core services (e.g., `Accountant`) must NEVER handle UI-specific formatting or delivery details (like Telegram HTML tags or bot-specific strings).
- **Workflow**: 
    1. Core service performs business logic.
    2. Core service emits a structured data event (e.g., `payment_created`, `tenant_registered`) via the message broker.
    3. The interface service (e.g., `Telegram Bot`) listens for these events.
    4. The interface service formats the message and handles delivery (including buttons, photos, and specific chat routing).

### Microservices Communication
- Use RabbitMQ for inter-service communication.
- Prefer asynchronous events (`emit`) for notifications and side effects.
- Use request-response (`send`) for data fetching across services.

## Development Standards
- All project documentation and code comments should be in English.
- Use Prisma for database interactions.
- **Prisma Migrations**: Any change to `schema.prisma` MUST be accompanied by a generated migration file in the `prisma/migrations` folder. Use `npx prisma migrate dev --name <description>` during development to ensure the schema and database stay in sync and the migration is tracked in source control.
- **Prisma Versioning**: Always use `npm run prisma:generate` or `npm run prisma:migrate` instead of `npx prisma`. This ensures the project stays on version 6.6.0 and avoids breaking changes introduced in Prisma 7.
- **Prisma Monorepo Isolation**: To prevent TypeScript type conflicts across microservices (where generating a client for one service overwrites the generic `@prisma/client` used by another), the project uses isolated internal clients.
    - The `schema.prisma` file explicitly outputs to a local directory: `output = "../src/generated/client"`.
    - Services import their specific client directly: `import { PrismaClient } from '../../generated/client'`.
    - *Crucial for Docker*: Ensure `RUN mkdir -p src/generated/client/runtime` is present in Dockerfiles before `prisma generate` to prevent `ENOENT` copyfile bugs on Alpine.
- Ensure all BigInt values are serialized correctly when passing through the message broker.
