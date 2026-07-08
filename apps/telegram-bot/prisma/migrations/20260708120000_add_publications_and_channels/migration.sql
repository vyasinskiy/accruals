-- CreateTable
CREATE TABLE "publication_channels" (
    "id" SERIAL NOT NULL,
    "chat_id" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publication_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publications" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel_id" INTEGER NOT NULL,

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "publication_channels_chat_id_key" ON "publication_channels"("chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "publications_invoice_id_channel_id_key" ON "publications"("invoice_id", "channel_id");

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "publication_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropTable
DROP TABLE "published_invoices";
