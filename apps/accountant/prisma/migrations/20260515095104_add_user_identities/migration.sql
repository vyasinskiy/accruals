/*
  Warnings:

  - You are about to drop the column `telegram_id` on the `users` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "users_telegram_id_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "telegram_id";

-- CreateTable
CREATE TABLE "user_identities" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "platform" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_platform_external_id_key" ON "user_identities"("platform", "external_id");

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
