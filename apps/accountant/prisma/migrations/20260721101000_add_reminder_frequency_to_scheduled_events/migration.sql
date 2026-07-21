-- AlterTable
ALTER TABLE "scheduled_events" ADD COLUMN     "reminder_frequency" TEXT NOT NULL DEFAULT 'weekly';
