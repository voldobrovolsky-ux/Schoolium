-- AR-4: единый журнал оценок — Grade (Phase-0) мигрирует в JournalCell (Phase-1) и удаляется.
-- Ручная миграция с переносом данных (деструктивный авто-diff недопустим).

-- 1) новые колонки JournalCell (comment/source/updatedAt — поля Phase-0)
ALTER TABLE "JournalCell" ADD COLUMN "comment" TEXT;
ALTER TABLE "JournalCell" ADD COLUMN "source" "GradeSource" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "JournalCell" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 2) дедуп существующих ячеек перед уникальным индексом: остаётся самая свежая
--    запись на пару (studentId, lessonId); при равенстве времени — больший id
DELETE FROM "JournalCell" jc
USING "JournalCell" newer
WHERE jc."studentId" = newer."studentId"
  AND jc."lessonId" = newer."lessonId"
  AND (jc."postedAt" < newer."postedAt"
       OR (jc."postedAt" = newer."postedAt" AND jc."id" < newer."id"));

-- 3) семантика «одна ячейка на ученика×урок» (как в Phase-0) + индекс чтения по уроку
CREATE UNIQUE INDEX "JournalCell_studentId_lessonId_key" ON "JournalCell"("studentId", "lessonId");
CREATE INDEX "JournalCell_lessonId_idx" ON "JournalCell"("lessonId");

-- 4) перенос данных Grade → JournalCell (absent → 'н'; classId/disciplineId из урока).
--    Существующая Phase-1 ячейка приоритетнее (DO NOTHING). Строки без значения и без
--    absent (комментарий-сироты) не переносятся — в ячеечной модели им нет представления.
INSERT INTO "JournalCell"
  ("id", "workspaceId", "classId", "disciplineId", "studentId", "lessonId",
   "grade", "comment", "source", "postedBy", "postedAt", "updatedAt")
SELECT g."id", g."workspaceId", l."classId", l."subjectId", g."studentId", g."lessonId",
       CASE WHEN g."absent" THEN 'н' ELSE g."value"::text END,
       g."comment", g."source", g."createdBy", g."createdAt", g."updatedAt"
FROM "Grade" g
JOIN "Lesson" l ON l."id" = g."lessonId"
WHERE (g."value" IS NOT NULL OR g."absent")
ON CONFLICT ("studentId", "lessonId") DO NOTHING;

-- 5) Phase-0 таблица удаляется — источник истины один (AR-4)
DROP TABLE "Grade";
