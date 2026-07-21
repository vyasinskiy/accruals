-- CreateTable
CREATE TABLE "event_attachments" (
    "id" SERIAL NOT NULL,
    "scheduled_event_id" INTEGER,
    "event_trigger_id" INTEGER,
    "file_name" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "file_size" INTEGER,
    "mime_type" TEXT,
    "telegram_file_id" TEXT,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_attachments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "event_attachments" ADD CONSTRAINT "event_attachments_scheduled_event_id_fkey" FOREIGN KEY ("scheduled_event_id") REFERENCES "scheduled_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attachments" ADD CONSTRAINT "event_attachments_event_trigger_id_fkey" FOREIGN KEY ("event_trigger_id") REFERENCES "event_triggers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
