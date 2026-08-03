ALTER TABLE "scheduled_events" ADD COLUMN "event_type" TEXT NOT NULL DEFAULT 'notification'; ALTER TABLE "accounts" DROP COLUMN IF EXISTS "meter_submission_day";
