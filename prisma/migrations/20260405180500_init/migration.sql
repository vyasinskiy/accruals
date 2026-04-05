-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "runs" (
    "id" SERIAL NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "accounts_scanned" INTEGER NOT NULL DEFAULT 0,
    "receipts_observed" INTEGER NOT NULL DEFAULT 0,
    "new_receipts" INTEGER NOT NULL DEFAULT 0,
    "needs_login" BOOLEAN NOT NULL DEFAULT false,
    "summary_json" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" SERIAL NOT NULL,
    "account_external_id" TEXT NOT NULL,
    "month_label" TEXT NOT NULL,
    "amount_text" TEXT NOT NULL,
    "status_text" TEXT,
    "receipt_available" BOOLEAN NOT NULL DEFAULT false,
    "receipt_url" TEXT,
    "receipt_downloaded" BOOLEAN NOT NULL DEFAULT false,
    "fingerprint" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "raw_json" TEXT,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_observations" (
    "id" SERIAL NOT NULL,
    "receipt_id" INTEGER NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "run_id" INTEGER,
    "raw_json" TEXT,
    "receipt_fingerprint" TEXT NOT NULL,

    CONSTRAINT "receipt_observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receipts_fingerprint_key" ON "receipts"("fingerprint");

-- CreateIndex
CREATE INDEX "idx_receipts_account_month" ON "receipts"("account_external_id", "month_label");

-- CreateIndex
CREATE INDEX "idx_receipt_observations_fingerprint" ON "receipt_observations"("receipt_fingerprint");

-- CreateIndex
CREATE INDEX "idx_receipt_observations_receipt_id" ON "receipt_observations"("receipt_id");

-- AddForeignKey
ALTER TABLE "receipt_observations" ADD CONSTRAINT "receipt_observations_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_observations" ADD CONSTRAINT "receipt_observations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

