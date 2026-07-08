-- AlterTable
ALTER TABLE "users" ADD COLUMN "telegram_id" BIGINT;

-- MigrateData: Copy external_id from user_identities to users.telegram_id for telegram platform
UPDATE "users" u
SET "telegram_id" = CAST(ui."external_id" AS BIGINT)
FROM "user_identities" ui
WHERE ui."user_id" = u."id" AND ui."platform" = 'telegram';

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_id_key" ON "users"("telegram_id");

-- DropTable
DROP TABLE "user_identities";
