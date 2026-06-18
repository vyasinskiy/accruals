-- CreateTable
CREATE TABLE "published_invoices" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "chat_id" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "published_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "published_invoices_invoice_id_chat_id_key" ON "published_invoices"("invoice_id", "chat_id");
