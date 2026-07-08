-- AlterTable
ALTER TABLE "users" ADD COLUMN "tenant_id" INTEGER;

-- AlterTable
ALTER TABLE "publication_channels" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'personal';

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_key" ON "users"("tenant_id");
