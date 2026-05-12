/*
  Warnings:

  - You are about to drop the column `tenant_id` on the `payments` table. All the data in the column will be lost.
  - You are about to alter the column `user_id` on the `payments` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Integer`.
  - You are about to drop the column `name` on the `tenants` table. All the data in the column will be lost.
  - You are about to drop the column `telegram_id` on the `tenants` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[user_id]` on the table `tenants` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `user_id` to the `tenants` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_tenant_id_fkey";

-- DropIndex
DROP INDEX "tenants_telegram_id_key";

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "tenant_id",
ALTER COLUMN "user_id" SET DATA TYPE INTEGER;

-- AlterTable
ALTER TABLE "tenants" DROP COLUMN "name",
DROP COLUMN "telegram_id",
ADD COLUMN     "user_id" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'tenant',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_id_key" ON "users"("telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_user_id_key" ON "tenants"("user_id");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
