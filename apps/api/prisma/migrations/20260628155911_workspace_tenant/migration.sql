-- ============================================================================
-- Канон Флёра: ШКОЛА = Workspace (единица изоляции тенанта). Ключ organizationId → workspaceId.
-- Organization → платформа EduStore (одна). Worknet = сеть школ (синк — стаб).
-- Данные демо-школы СОХРАНЯЕМ: RENAME колонок (не drop), конверсия Organization→Workspace.
-- ============================================================================

-- 0. Снять FK доменных таблиц на Organization (она больше не тенант)
ALTER TABLE "Subject" DROP CONSTRAINT "Subject_organizationId_fkey";
ALTER TABLE "Class" DROP CONSTRAINT "Class_organizationId_fkey";
ALTER TABLE "Membership" DROP CONSTRAINT "Membership_orgId_fkey";
ALTER TABLE "Device" DROP CONSTRAINT "Device_orgId_fkey";

-- 1. organizationId → workspaceId на доменных таблицах (+ переименование индексов)
ALTER TABLE "Teacher" RENAME COLUMN "organizationId" TO "workspaceId";
ALTER INDEX "Teacher_organizationId_idx" RENAME TO "Teacher_workspaceId_idx";
ALTER TABLE "TeachingAssignment" RENAME COLUMN "organizationId" TO "workspaceId";
ALTER INDEX "TeachingAssignment_organizationId_idx" RENAME TO "TeachingAssignment_workspaceId_idx";
ALTER TABLE "Subject" RENAME COLUMN "organizationId" TO "workspaceId";
CREATE INDEX "Subject_workspaceId_idx" ON "Subject"("workspaceId"); -- у Subject индекса не было (был FK)
ALTER TABLE "Class" RENAME COLUMN "organizationId" TO "workspaceId";
ALTER INDEX "Class_organizationId_idx" RENAME TO "Class_workspaceId_idx";
ALTER TABLE "SubGroup" RENAME COLUMN "organizationId" TO "workspaceId";
ALTER INDEX "SubGroup_organizationId_idx" RENAME TO "SubGroup_workspaceId_idx";
ALTER TABLE "Student" RENAME COLUMN "organizationId" TO "workspaceId";
ALTER INDEX "Student_organizationId_idx" RENAME TO "Student_workspaceId_idx";
ALTER TABLE "Lesson" RENAME COLUMN "organizationId" TO "workspaceId";
ALTER TABLE "Grade" RENAME COLUMN "organizationId" TO "workspaceId";
ALTER INDEX "Grade_organizationId_idx" RENAME TO "Grade_workspaceId_idx";
ALTER TABLE "GeneratedMaterial" RENAME COLUMN "organizationId" TO "workspaceId";
ALTER INDEX "GeneratedMaterial_organizationId_idx" RENAME TO "GeneratedMaterial_workspaceId_idx";
ALTER TABLE "StudentProfile" RENAME COLUMN "organizationId" TO "workspaceId";
ALTER INDEX "StudentProfile_organizationId_idx" RENAME TO "StudentProfile_workspaceId_idx";
ALTER TABLE "TeacherNote" RENAME COLUMN "organizationId" TO "workspaceId";
ALTER INDEX "TeacherNote_organizationId_idx" RENAME TO "TeacherNote_workspaceId_idx";
ALTER TABLE "Notification" RENAME COLUMN "organizationId" TO "workspaceId";
ALTER INDEX "Notification_organizationId_idx" RENAME TO "Notification_workspaceId_idx";
ALTER TABLE "ChannelMembership" RENAME COLUMN "organizationId" TO "workspaceId";
ALTER TABLE "MealOrder" RENAME COLUMN "organizationId" TO "workspaceId";
ALTER TABLE "Consent" RENAME COLUMN "organizationId" TO "workspaceId";
ALTER INDEX "Consent_organizationId_subjectUserId_purpose_idx" RENAME TO "Consent_workspaceId_subjectUserId_purpose_idx";
ALTER TABLE "AuditLog" RENAME COLUMN "organizationId" TO "workspaceId";
ALTER INDEX "AuditLog_organizationId_occurredAt_idx" RENAME TO "AuditLog_workspaceId_occurredAt_idx";
ALTER TABLE "Entitlement" RENAME COLUMN "organizationId" TO "workspaceId";
ALTER INDEX "Entitlement_organizationId_idx" RENAME TO "Entitlement_workspaceId_idx";
ALTER TABLE "OutboxEvent" RENAME COLUMN "organizationId" TO "workspaceId";

-- 2. Membership / Device / Session: orgId → workspaceId (+ florusWorkspaceId)
ALTER TABLE "Membership" RENAME COLUMN "orgId" TO "workspaceId";
ALTER INDEX "Membership_florusUserId_orgId_key" RENAME TO "Membership_florusUserId_workspaceId_key";
ALTER TABLE "Device" RENAME COLUMN "orgId" TO "workspaceId";
ALTER INDEX "Device_orgId_idx" RENAME TO "Device_workspaceId_idx";
ALTER TABLE "Session" RENAME COLUMN "orgId" TO "workspaceId";
ALTER TABLE "Session" ADD COLUMN "florusWorkspaceId" TEXT;

-- 3. Новые таблицы Worknet, Workspace
CREATE TABLE "Worknet" (
    "id" TEXT NOT NULL,
    "florusWorknetId" TEXT,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Worknet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Worknet_florusWorknetId_key" ON "Worknet"("florusWorknetId");
CREATE UNIQUE INDEX "Worknet_id_orgId_key" ON "Worknet"("id", "orgId");

CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "florusWorkspaceId" TEXT,
    "orgId" TEXT NOT NULL,
    "worknetId" TEXT,
    "name" TEXT NOT NULL,
    "sector" TEXT NOT NULL DEFAULT 'private',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Workspace_florusWorkspaceId_key" ON "Workspace"("florusWorkspaceId");
CREATE INDEX "Workspace_orgId_idx" ON "Workspace"("orgId");
CREATE INDEX "Workspace_worknetId_idx" ON "Workspace"("worknetId");

-- 4. Данные: платформа + конверсия существующих school-Organization → Workspace
INSERT INTO "Organization" ("id", "name", "type", "status", "createdAt")
    VALUES ('org-edustore-platform', 'EduStore', 'platform', 'active', now());
INSERT INTO "Workspace" ("id", "florusWorkspaceId", "orgId", "worknetId", "name", "sector", "status", "createdAt")
    SELECT o."id", o."florusOrgId", 'org-edustore-platform', NULL, o."name", o."sector", o."status", o."createdAt"
    FROM "Organization" o WHERE o."id" <> 'org-edustore-platform';
DELETE FROM "Organization" WHERE "id" <> 'org-edustore-platform';

-- 5. Organization → платформа: убрать sector, дефолт type = platform
ALTER TABLE "Organization" DROP COLUMN "sector";
ALTER TABLE "Organization" ALTER COLUMN "type" SET DEFAULT 'platform';

-- 6. Новые внешние ключи
ALTER TABLE "Worknet" ADD CONSTRAINT "Worknet_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_worknetId_fkey" FOREIGN KEY ("worknetId") REFERENCES "Worknet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Device" ADD CONSTRAINT "Device_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
