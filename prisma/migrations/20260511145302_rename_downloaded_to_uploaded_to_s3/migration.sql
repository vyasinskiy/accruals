/*
  Warnings:

  - You are about to rename the column `downloaded` to `uploaded_to_s3` on the `invoices` table.

*/
-- AlterTable
ALTER TABLE "invoices" RENAME COLUMN "downloaded" TO "uploaded_to_s3";
