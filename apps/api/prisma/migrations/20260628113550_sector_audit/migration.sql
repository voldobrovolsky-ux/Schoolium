-- §3.7 Классификация организации: sector (private | state) — ветвление 152-ФЗ.
ALTER TABLE "Organization" ADD COLUMN "sector" TEXT NOT NULL DEFAULT 'private';

-- §4.8 Audit-леджер: append-only иммутабельный журнал (документооборот-как-протоколы + 152-ФЗ).
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actor" TEXT,
    "subjectUserId" TEXT,
    "action" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "persDataCategories" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_eventId_action_key" ON "AuditLog"("eventId", "action");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_occurredAt_idx" ON "AuditLog"("organizationId", "occurredAt");
