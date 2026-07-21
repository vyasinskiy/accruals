-- AlterTable
ALTER TABLE "scheduled_events" ADD COLUMN     "reminder_day_of_month" INTEGER DEFAULT 20,
ADD COLUMN     "reminder_day_of_week" INTEGER DEFAULT 1,
ADD COLUMN     "reminder_time_of_day" TEXT DEFAULT '10:00';
