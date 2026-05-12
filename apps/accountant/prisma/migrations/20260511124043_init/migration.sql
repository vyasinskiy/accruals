-- CreateTable
CREATE TABLE "apartments" (
    "id" SERIAL NOT NULL,
    "external_id" TEXT NOT NULL,
    "address" TEXT,
    "organization" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "apartments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" SERIAL NOT NULL,
    "external_id" TEXT NOT NULL,
    "apartment_id" INTEGER NOT NULL,
    "account_number" TEXT,
    "account_label" TEXT,
    "raw_json" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accruals" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "account_external_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "period_label" TEXT NOT NULL,
    "amount_text" TEXT,
    "status_text" TEXT,
    "source_url" TEXT,
    "raw_json" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accruals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" SERIAL NOT NULL,
    "account_id" INTEGER NOT NULL,
    "account_external_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "period_label" TEXT NOT NULL,
    "invoice_url" TEXT,
    "utilities_url" TEXT,
    "local_file_path" TEXT,
    "available" BOOLEAN NOT NULL DEFAULT false,
    "downloaded" BOOLEAN NOT NULL DEFAULT false,
    "raw_json" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" SERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "user_name" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "receipt_photo_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unconfirmed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by" BIGINT,
    "comment" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "apartments_external_id_key" ON "apartments"("external_id");

-- CreateIndex
CREATE INDEX "idx_apartments_address" ON "apartments"("address");

-- CreateIndex
CREATE INDEX "idx_apartments_organization" ON "apartments"("organization");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_external_id_key" ON "accounts"("external_id");

-- CreateIndex
CREATE INDEX "idx_accounts_number" ON "accounts"("account_number");

-- CreateIndex
CREATE INDEX "idx_accruals_account_period" ON "accruals"("account_id", "period_label");

-- CreateIndex
CREATE UNIQUE INDEX "accruals_account_external_id_period_id_key" ON "accruals"("account_external_id", "period_id");

-- CreateIndex
CREATE INDEX "idx_invoices_account_period" ON "invoices"("account_id", "period_label");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_account_external_id_period_id_key" ON "invoices"("account_external_id", "period_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_apartment_id_fkey" FOREIGN KEY ("apartment_id") REFERENCES "apartments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accruals" ADD CONSTRAINT "accruals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
