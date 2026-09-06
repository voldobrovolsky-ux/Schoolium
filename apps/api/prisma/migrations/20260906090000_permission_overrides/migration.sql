-- Schoolium 1.6.0 — разрешения правит администратор школы (AR-212).
--
-- Пакеты прав ролей (`ROLE_PERMISSIONS`) остаются каноном версии и продолжают
-- пересеваться на старте (`syncAuthzCatalog` прунит всё, чего нет в каноне) —
-- поэтому школьная правка НЕ пишется в `RolePackagePermission`, а живёт
-- отдельной таблицей отклонений и накладывается поверх пакета при резолве.
-- Иначе каждый рестарт стирал бы настройку школы.
--
-- expand only: новая таблица, ни одна существующая не трогается.

-- CreateTable
CREATE TABLE "SchoolPermissionOverride" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolPermissionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchoolPermissionOverride_workspaceId_scope_subject_idx" ON "SchoolPermissionOverride"("workspaceId", "scope", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolPermissionOverride_workspaceId_scope_subject_permissi_key" ON "SchoolPermissionOverride"("workspaceId", "scope", "subject", "permission");
