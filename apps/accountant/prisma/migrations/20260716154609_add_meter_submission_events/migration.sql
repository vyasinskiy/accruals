-- CreateTable
CREATE TABLE "meter_submission_events" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "period_id" TEXT NOT NULL,
    "period_label" TEXT NOT NULL,
    "target_date" TIMESTAMP(3) NOT NULL,
    "notification_sent" BOOLEAN NOT NULL DEFAULT false,
    "readings_submitted" BOOLEAN NOT NULL DEFAULT false,
    "submitted_at" TIMESTAMP(3),
    "last_reminder_sent" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meter_submission_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meter_submission_events_account_id_period_id_key" ON "meter_submission_events"("account_id", "period_id");

-- AddForeignKey
ALTER TABLE "meter_submission_events" ADD CONSTRAINT "meter_submission_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
