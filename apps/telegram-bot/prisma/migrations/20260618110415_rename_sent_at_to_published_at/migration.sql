/*
  Warnings:

  - You are about to drop the column `sent_at` on the `published_invoices` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "published_invoices" DROP COLUMN "sent_at",
ADD COLUMN     "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
