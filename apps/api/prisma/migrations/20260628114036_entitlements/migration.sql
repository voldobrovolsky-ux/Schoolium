-- §5.2 Entitlements / SKU: гейт загрузки модуля = активный entitlement тенанта.

-- CreateEnum
CREATE TYPE "SkuKind" AS ENUM ('module', 'seat', 'bundle');

-- CreateEnum
CREATE TYPE "EntitlementStatus" AS ENUM ('active', 'trial', 'expired');

-- CreateTable
CREATE TABLE "Sku" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "SkuKind" NOT NULL,
    "label" TEXT NOT NULL,
    CONSTRAINT "Sku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entitlement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "status" "EntitlementStatus" NOT NULL DEFAULT 'active',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "seats" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Entitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "redeemed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sku_key_key" ON "Sku"("key");

-- CreateIndex
CREATE INDEX "Entitlement_organizationId_idx" ON "Entitlement"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_code_key" ON "PromoCode"("code");

-- AddForeignKey
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "Sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
