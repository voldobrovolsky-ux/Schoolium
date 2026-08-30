-- Schoolium 1.1.1 — онбординг школы (AR-99, AR-104). Ворота G-47.
--
-- Правило миграции: expand → migrate → contract.
--   expand   — 20 новых таблиц (11 доменных + проекции журнала + регистр школы +
--              карточки персонала + пять таблиц контура доступа) и новые колонки
--              существующих таблиц КОНТУРА ДОСТУПА (`User`, `Membership`);
--   migrate  — backfill `Membership.userId` из `florusUserId` (значения совпадают);
--   contract — снятие `florus*`-полей ОТЛОЖЕНО: это отдельный инкремент AR-58,
--              а не часть этой версии.
--
-- Контур КТП/КПП НЕ ТРОГАЕТСЯ: в миграции нет ни одного `ALTER TABLE` по его
-- таблицам (`Student`, `Subject`, `Lesson`, `Class`, `SubGroup`,
-- `TeachingAssignment`, `Timetable`, `TimetableSlot`, `JournalCell`, `Teacher`).
-- Три занятых доменных имени разведены префиксом `School*` (AR-104): legacy не
-- переименовывается и не удаляется — два контура живут в одной базе, но не в
-- одном сценарии (прецедент AR-83, AR-84).

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "middleName" TEXT,
ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "SchoolClass" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "parallel" INTEGER NOT NULL,
    "letter" TEXT,
    "label" TEXT NOT NULL,
    "groupCount" INTEGER NOT NULL DEFAULT 0,
    "plannedStudents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentGroup" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "groupNo" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "StudentGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolStudent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "groupId" TEXT,
    "seq" INTEGER NOT NULL,
    "lastName" TEXT NOT NULL DEFAULT '',
    "firstName" TEXT NOT NULL DEFAULT '',
    "middleName" TEXT,
    "sex" TEXT,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolStudent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolSubject" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "priority" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherBinding" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "groupNos" INTEGER[],
    "hoursPerWeek" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeacherBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Term" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "termNo" INTEGER NOT NULL,
    "dateFrom" DATE NOT NULL,
    "dateTo" DATE NOT NULL,

    CONSTRAINT "Term_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "seed" INTEGER NOT NULL,
    "days" INTEGER NOT NULL,
    "slotsPerDay" INTEGER NOT NULL,
    "lessonMin" INTEGER NOT NULL,
    "breakMin" INTEGER NOT NULL,
    "bigBreakAfter" INTEGER NOT NULL,
    "bigBreakMin" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "ScheduleTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateSlot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "dayNo" INTEGER NOT NULL,
    "slotNo" INTEGER NOT NULL,
    "classId" TEXT NOT NULL,
    "groupNo" INTEGER NOT NULL DEFAULT 0,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,

    CONSTRAINT "TemplateSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolLesson" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "slotNo" INTEGER NOT NULL,
    "classId" TEXT NOT NULL,
    "groupNo" INTEGER NOT NULL DEFAULT 0,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "templateId" TEXT,
    "detachedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalColumn" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "slotNo" INTEGER NOT NULL,
    "classId" TEXT NOT NULL,
    "groupNo" INTEGER NOT NULL DEFAULT 0,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "detachedAt" TIMESTAMP(3),

    CONSTRAINT "JournalColumn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalRow" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "sex" TEXT,
    "groupNo" INTEGER,
    "deactivated" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mark" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "postedBy" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonTopic" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "setBy" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolState" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contingentVersion" INTEGER NOT NULL DEFAULT 0,
    "scheduleVersion" INTEGER NOT NULL DEFAULT 0,
    "days" INTEGER NOT NULL DEFAULT 5,
    "slotsPerDay" INTEGER NOT NULL DEFAULT 0,
    "lessonMin" INTEGER NOT NULL DEFAULT 45,
    "breakMin" INTEGER NOT NULL DEFAULT 10,
    "bigBreakAfter" INTEGER NOT NULL DEFAULT 2,
    "bigBreakMin" INTEGER NOT NULL DEFAULT 20,
    "dayParamsSet" BOOLEAN NOT NULL DEFAULT false,
    "prioritiesSet" BOOLEAN NOT NULL DEFAULT false,
    "lastEditorId" TEXT,
    "lastEditorName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffCard" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "section" INTEGER NOT NULL,
    "plannedRoles" TEXT[],
    "userId" TEXT,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSession" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "roles" TEXT[],
    "deviceHint" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "AppSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceLinkToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "workspaceId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'waiting',
    "approvedBy" TEXT,
    "sessionId" TEXT,
    "nextPath" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginCode" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivationToken" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "roles" TEXT[],
    "state" TEXT NOT NULL DEFAULT 'waiting',
    "scannedBy" TEXT,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BootstrapLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BootstrapLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchoolClass_workspaceId_idx" ON "SchoolClass"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolClass_workspaceId_parallel_letter_key" ON "SchoolClass"("workspaceId", "parallel", "letter");

-- CreateIndex
CREATE INDEX "StudentGroup_workspaceId_idx" ON "StudentGroup"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentGroup_classId_groupNo_key" ON "StudentGroup"("classId", "groupNo");

-- CreateIndex
CREATE INDEX "SchoolStudent_workspaceId_idx" ON "SchoolStudent"("workspaceId");

-- CreateIndex
CREATE INDEX "SchoolStudent_classId_idx" ON "SchoolStudent"("classId");

-- CreateIndex
CREATE INDEX "SchoolSubject_workspaceId_idx" ON "SchoolSubject"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolSubject_workspaceId_name_classId_key" ON "SchoolSubject"("workspaceId", "name", "classId");

-- CreateIndex
CREATE INDEX "TeacherBinding_workspaceId_idx" ON "TeacherBinding"("workspaceId");

-- CreateIndex
CREATE INDEX "TeacherBinding_subjectId_idx" ON "TeacherBinding"("subjectId");

-- CreateIndex
CREATE INDEX "TeacherBinding_teacherId_idx" ON "TeacherBinding"("teacherId");

-- CreateIndex
CREATE INDEX "Term_workspaceId_idx" ON "Term"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Term_workspaceId_termNo_key" ON "Term"("workspaceId", "termNo");

-- CreateIndex
CREATE INDEX "ScheduleTemplate_workspaceId_idx" ON "ScheduleTemplate"("workspaceId");

-- CreateIndex
CREATE INDEX "TemplateSlot_workspaceId_idx" ON "TemplateSlot"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateSlot_templateId_dayNo_slotNo_classId_groupNo_key" ON "TemplateSlot"("templateId", "dayNo", "slotNo", "classId", "groupNo");

-- CreateIndex
CREATE INDEX "SchoolLesson_workspaceId_classId_date_idx" ON "SchoolLesson"("workspaceId", "classId", "date");

-- CreateIndex
CREATE INDEX "SchoolLesson_workspaceId_teacherId_idx" ON "SchoolLesson"("workspaceId", "teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolLesson_workspaceId_date_slotNo_classId_groupNo_key" ON "SchoolLesson"("workspaceId", "date", "slotNo", "classId", "groupNo");

-- CreateIndex
CREATE UNIQUE INDEX "JournalColumn_lessonId_key" ON "JournalColumn"("lessonId");

-- CreateIndex
CREATE INDEX "JournalColumn_workspaceId_classId_subjectId_idx" ON "JournalColumn"("workspaceId", "classId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalRow_studentId_key" ON "JournalRow"("studentId");

-- CreateIndex
CREATE INDEX "JournalRow_workspaceId_classId_idx" ON "JournalRow"("workspaceId", "classId");

-- CreateIndex
CREATE INDEX "Mark_workspaceId_idx" ON "Mark"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Mark_lessonId_studentId_key" ON "Mark"("lessonId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonTopic_lessonId_key" ON "LessonTopic"("lessonId");

-- CreateIndex
CREATE INDEX "LessonTopic_workspaceId_idx" ON "LessonTopic"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolState_workspaceId_key" ON "SchoolState"("workspaceId");

-- CreateIndex
CREATE INDEX "StaffCard_workspaceId_idx" ON "StaffCard"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "AppSession_token_key" ON "AppSession"("token");

-- CreateIndex
CREATE INDEX "AppSession_userId_idx" ON "AppSession"("userId");

-- CreateIndex
CREATE INDEX "AppSession_workspaceId_idx" ON "AppSession"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceLinkToken_token_key" ON "DeviceLinkToken"("token");

-- CreateIndex
CREATE INDEX "LoginCode_workspaceId_idx" ON "LoginCode"("workspaceId");

-- CreateIndex
CREATE INDEX "LoginCode_code_idx" ON "LoginCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ActivationToken_token_key" ON "ActivationToken"("token");

-- CreateIndex
CREATE INDEX "ActivationToken_workspaceId_idx" ON "ActivationToken"("workspaceId");

-- CreateIndex
CREATE INDEX "ActivationToken_targetId_idx" ON "ActivationToken"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "BootstrapLink_token_key" ON "BootstrapLink"("token");

-- CreateIndex
CREATE INDEX "BootstrapLink_workspaceId_idx" ON "BootstrapLink"("workspaceId");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- AddForeignKey
ALTER TABLE "StudentGroup" ADD CONSTRAINT "StudentGroup_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolStudent" ADD CONSTRAINT "SchoolStudent_classId_fkey" FOREIGN KEY ("classId") REFERENCES "SchoolClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolStudent" ADD CONSTRAINT "SchoolStudent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "StudentGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherBinding" ADD CONSTRAINT "TeacherBinding_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "SchoolSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateSlot" ADD CONSTRAINT "TemplateSlot_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ScheduleTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mark" ADD CONSTRAINT "Mark_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "JournalColumn"("lessonId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mark" ADD CONSTRAINT "Mark_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "JournalRow"("studentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonTopic" ADD CONSTRAINT "LessonTopic_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "JournalColumn"("lessonId") ON DELETE CASCADE ON UPDATE CASCADE;




-- migrate: `userId` заводится параллельно `florusUserId`, значения совпадают.
-- `roles` у legacy-членств остаётся пустым осознанно: словарь
-- teacher|student|parent|staff не выражает шести ролей версии (AR-60), и
-- заполнять массив догадкой означало бы выдать legacy-пользователям права 1.1.1.
UPDATE "Membership" SET "userId" = "florusUserId" WHERE "userId" IS NULL;
