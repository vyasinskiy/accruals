/*
  Warnings:

  - You are about to drop the column `completed_without_submission` on the `meter_submission_events` table. All the data in the column will be lost.
  - You are about to drop the column `readings_received` on the `meter_submission_events` table. All the data in the column will be lost.
  - You are about to drop the column `readings_submitted` on the `meter_submission_events` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "meter_submission_events" DROP COLUMN "completed_without_submission",
DROP COLUMN "readings_received",
DROP COLUMN "readings_submitted",
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PENDING';
