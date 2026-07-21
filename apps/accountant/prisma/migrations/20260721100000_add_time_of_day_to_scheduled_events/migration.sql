-- AlterTable
ALTER TABLE "scheduled_events" ADD COLUMN IF NOT EXISTS "time_of_day" TEXT NOT NULL DEFAULT '10:00';
