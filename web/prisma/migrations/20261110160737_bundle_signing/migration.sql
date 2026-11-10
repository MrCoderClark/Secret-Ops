-- CreateTable
CREATE TABLE "bundle_keys" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "wrappedDek" TEXT NOT NULL,
    "dekIv" TEXT NOT NULL,
    "dekAuthTag" TEXT NOT NULL,
    "keyId" TEXT NOT NULL DEFAULT 'kek-v1',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "bundle_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bundle_keys_organizationId_active_idx" ON "bundle_keys"("organizationId", "active");

-- AddForeignKey
ALTER TABLE "bundle_keys" ADD CONSTRAINT "bundle_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_keys" ADD CONSTRAINT "bundle_keys_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
