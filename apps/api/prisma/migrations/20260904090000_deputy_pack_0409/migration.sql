-- Schoolium 1.5.0 — пакет 04.09 (AR-199…AR-207): обед по классам (AR-200),
-- ключ имени предмета (AR-201), группы в компетенциях (AR-202), карточка
-- сотрудника и ссылка входа с параметрами (AR-203, AR-204), лимиты носителей
-- ролей (AR-205), предпочтения педагога (AR-206), отмена урока и замена (AR-207).
-- СанПиН выключен решением владельца (AR-199) — схемы не касается.
--
-- Правило миграции: expand only. Контур КТП/КПП не трогается; доменные таблицы
-- расширяются nullable/defaulted колонками, новые таблицы добавляются —
-- откат кода на прежний тег остаётся возможным, лишние колонки старый код не
-- читает. Уникального индекса по ключу имени предмета здесь НЕТ намеренно: прод
-- ещё не слит (`subjects:merge`), уникальность держит код (`SUBJECT_EXISTS`).

-- AlterTable · обед по классам (AR-200)
ALTER TABLE "SchoolClass" ADD COLUMN     "lunchAfterLessonNo" INTEGER;

-- AlterTable · ключ имени предмета (AR-201) + бэкфилл тем же правилом, что
-- `subjectNameKey`: trim, пробелы в один, нижний регистр, «ё» → «е»
ALTER TABLE "SchoolSubject" ADD COLUMN     "nameKey" TEXT;
UPDATE "SchoolSubject" SET "nameKey" = replace(lower(regexp_replace(btrim("name"), '\s+', ' ', 'g')), 'ё', 'е') WHERE "nameKey" IS NULL;

-- AlterTable · ссылка входа: лимит открытий (AR-204)
ALTER TABLE "BootstrapLink" ADD COLUMN     "maxUses" INTEGER,
ADD COLUMN     "useCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable · лимиты носителей ролей (AR-205)
ALTER TABLE "SchoolAccessPolicy" ADD COLUMN     "roleLimits" JSONB NOT NULL DEFAULT '{}';

-- AlterTable · колонка журнала отменённого урока (AR-207)
ALTER TABLE "JournalColumn" ADD COLUMN     "cancelledAt" TIMESTAMP(3);

-- CreateTable · предпочтения педагога (AR-206)
CREATE TABLE "TeacherPreference" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "workDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeacherPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable · замена урока (AR-207)
CREATE TABLE "LessonSubstitution" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "originalTeacherId" TEXT NOT NULL,
    "substituteTeacherId" TEXT,
    "reason" TEXT NOT NULL,
    "reasonText" TEXT,
    "status" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "LessonSubstitution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex · ключ имени предмета: обычный индекс (уникальный — следующей миграцией)
CREATE INDEX "SchoolSubject_workspaceId_nameKey_classId_idx" ON "SchoolSubject"("workspaceId", "nameKey", "classId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherPreference_workspaceId_teacherId_key" ON "TeacherPreference"("workspaceId", "teacherId");

-- CreateIndex
CREATE INDEX "LessonSubstitution_workspaceId_idx" ON "LessonSubstitution"("workspaceId");

-- CreateIndex
CREATE INDEX "LessonSubstitution_workspaceId_originalTeacherId_idx" ON "LessonSubstitution"("workspaceId", "originalTeacherId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonSubstitution_lessonId_key" ON "LessonSubstitution"("lessonId");
