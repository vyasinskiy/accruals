.PHONY: deploy prisma-generate

deploy:
	@cd infra && ./deploy.sh

prisma-generate:
	@echo "Generating Prisma client for accountant..."
	@npm run --prefix apps/accountant prisma:generate
	@echo "Generating Prisma client for telegram-bot..."
	@npm run --prefix apps/telegram-bot prisma:generate
	@echo "Generating Prisma client for watcher..."
	@npm run --prefix apps/watcher prisma:generate
