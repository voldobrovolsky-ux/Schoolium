-- §6 Consent 152-ФЗ: объект согласия на обработку ПДн (append-only).

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('data_processing', 'predictive_profiling', 'comms', 'media');

-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('self', 'guardian', 'school_admin');

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "source" "ConsentSource" NOT NULL,
    "evidenceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Consent_organizationId_subjectUserId_purpose_idx" ON "Consent"("organizationId", "subjectUserId", "purpose");
