-- CreateTable
CREATE TABLE "runs" (
    "id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "apartments_scanned" INTEGER NOT NULL DEFAULT 0,
    "accruals_observed" INTEGER NOT NULL DEFAULT 0,
    "invoices_observed" INTEGER NOT NULL DEFAULT 0,
    "new_apartments" INTEGER NOT NULL DEFAULT 0,
    "new_accruals" INTEGER NOT NULL DEFAULT 0,
    "new_invoices" INTEGER NOT NULL DEFAULT 0,
    "needs_login" BOOLEAN NOT NULL DEFAULT false,
    "summary_json" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);
