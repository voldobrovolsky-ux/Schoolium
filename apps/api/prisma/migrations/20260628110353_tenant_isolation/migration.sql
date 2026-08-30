-- §3.6 Изоляция тенанта: денормализация ключа тенанта organizationId на дочерние таблицы.
-- Паттерн на каждую таблицу: ADD COLUMN nullable → backfill из родителя → SET NOT NULL → index.
-- Backfill детерминирован FK-связями; осиротевших строк в консистентной БД нет.

-- Student ← Class
ALTER TABLE "Student" ADD COLUMN "organizationId" TEXT;
UPDATE "Student" s SET "organizationId" = c."organizationId" FROM "Class" c WHERE c.id = s."classId";
ALTER TABLE "Student" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "Student_organizationId_idx" ON "Student"("organizationId");

-- SubGroup ← Class
ALTER TABLE "SubGroup" ADD COLUMN "organizationId" TEXT;
UPDATE "SubGroup" sg SET "organizationId" = c."organizationId" FROM "Class" c WHERE c.id = sg."classId";
ALTER TABLE "SubGroup" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "SubGroup_organizationId_idx" ON "SubGroup"("organizationId");

-- TeachingAssignment ← Class
ALTER TABLE "TeachingAssignment" ADD COLUMN "organizationId" TEXT;
UPDATE "TeachingAssignment" ta SET "organizationId" = c."organizationId" FROM "Class" c WHERE c.id = ta."classId";
ALTER TABLE "TeachingAssignment" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "TeachingAssignment_organizationId_idx" ON "TeachingAssignment"("organizationId");

-- Grade ← Lesson
ALTER TABLE "Grade" ADD COLUMN "organizationId" TEXT;
UPDATE "Grade" g SET "organizationId" = l."organizationId" FROM "Lesson" l WHERE l.id = g."lessonId";
ALTER TABLE "Grade" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "Grade_organizationId_idx" ON "Grade"("organizationId");

-- GeneratedMaterial ← Lesson
ALTER TABLE "GeneratedMaterial" ADD COLUMN "organizationId" TEXT;
UPDATE "GeneratedMaterial" gm SET "organizationId" = l."organizationId" FROM "Lesson" l WHERE l.id = gm."lessonId";
ALTER TABLE "GeneratedMaterial" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "GeneratedMaterial_organizationId_idx" ON "GeneratedMaterial"("organizationId");

-- StudentProfile ← Student ← Class
ALTER TABLE "StudentProfile" ADD COLUMN "organizationId" TEXT;
UPDATE "StudentProfile" sp SET "organizationId" = c."organizationId"
  FROM "Student" s JOIN "Class" c ON c.id = s."classId" WHERE s.id = sp."studentId";
ALTER TABLE "StudentProfile" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "StudentProfile_organizationId_idx" ON "StudentProfile"("organizationId");

-- TeacherNote ← Teacher
ALTER TABLE "TeacherNote" ADD COLUMN "organizationId" TEXT;
UPDATE "TeacherNote" tn SET "organizationId" = t."organizationId" FROM "Teacher" t WHERE t.id = tn."teacherId";
ALTER TABLE "TeacherNote" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "TeacherNote_organizationId_idx" ON "TeacherNote"("organizationId");

-- Notification ← Teacher
ALTER TABLE "Notification" ADD COLUMN "organizationId" TEXT;
UPDATE "Notification" n SET "organizationId" = t."organizationId" FROM "Teacher" t WHERE t.id = n."teacherId";
ALTER TABLE "Notification" ALTER COLUMN "organizationId" SET NOT NULL;
CREATE INDEX "Notification_organizationId_idx" ON "Notification"("organizationId");
