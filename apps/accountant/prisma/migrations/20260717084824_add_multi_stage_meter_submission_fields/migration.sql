-- AlterTable
ALTER TABLE "meter_submission_events" ADD COLUMN     "completed_without_submission" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "readings_received" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "readings_value" TEXT,
ADD COLUMN     "received_at" TIMESTAMP(3);
