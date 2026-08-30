-- Schoolium 1.2.0 — запуск школы (specs/school-launch, AR-150…AR-162).
--
-- expand → migrate → contract:
--   expand  — юзернейм и пароль-фолбэк у `User` (AR-154, AR-156); `activatedAt`
--             у членства (AR-161: «зарегистрирован» = активировал вход сканом);
--             учётка ученика (`SchoolStudent.userId`, AR-155); карточки
--             родителей и связи с детьми (`GuardianCard`, `GuardianLink`);
--   migrate — существующие членства с ролями считаются активированными: они
--             прошли регистрацию контура 1.1.1 и держат живые сессии;
--   contract — нет: телефон остаётся колонкой (опциональной), PHONE_* контур
--             не удаляется — реестр кодов и данные суть журнал.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "username" TEXT,
ADD COLUMN     "passwordHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "activatedAt" TIMESTAMP(3);

-- migrate: контур 1.1.1 регистрировал человека сканом — членство с ролями
-- версии уже активировано его собственным маршрутом
UPDATE "Membership" SET "activatedAt" = "createdAt"
WHERE "roles" IS NOT NULL AND array_length("roles", 1) > 0;

-- AlterTable
ALTER TABLE "SchoolStudent" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "SchoolStudent_userId_idx" ON "SchoolStudent"("userId");

-- CreateTable
CREATE TABLE "GuardianCard" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardianCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuardianCard_workspaceId_idx" ON "GuardianCard"("workspaceId");

-- CreateTable
CREATE TABLE "GuardianLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "guardianCardId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardianLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuardianLink_guardianCardId_studentId_key" ON "GuardianLink"("guardianCardId", "studentId");
CREATE INDEX "GuardianLink_workspaceId_idx" ON "GuardianLink"("workspaceId");
CREATE INDEX "GuardianLink_studentId_idx" ON "GuardianLink"("studentId");

-- AddForeignKey
ALTER TABLE "GuardianLink" ADD CONSTRAINT "GuardianLink_guardianCardId_fkey" FOREIGN KEY ("guardianCardId") REFERENCES "GuardianCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuardianLink" ADD CONSTRAINT "GuardianLink_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "SchoolStudent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
