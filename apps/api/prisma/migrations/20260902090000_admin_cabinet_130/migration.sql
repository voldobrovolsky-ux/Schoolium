-- Schoolium 1.3.0 — кабинет администратора (AR-186…AR-189). Ворота G-81.
--
-- Правило миграции: expand only. Контур КТП/КПП не трогается; контур
-- доступа расширяется nullable/defaulted колонками — откат кода на прежний
-- тег остаётся возможным, лишние колонки старый клиент не читает.

-- AlterTable · происхождение сессии (AR-187)
ALTER TABLE "AppSession" ADD COLUMN     "via" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN     "clientKind" TEXT NOT NULL DEFAULT 'browser',
ADD COLUMN     "ip" TEXT,
ADD COLUMN     "parentSessionId" TEXT;

-- AlterTable · ссылка входа с карточки сотрудника (AR-189)
ALTER TABLE "BootstrapLink" ADD COLUMN     "purpose" TEXT NOT NULL DEFAULT 'bootstrap',
ADD COLUMN     "issuedBy" TEXT;

-- CreateTable · реестр Wi-Fi сетей школы
CREATE TABLE "SchoolNetwork" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ssid" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'staff',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolNetwork_pkey" PRIMARY KEY ("id")
);

-- CreateTable · реестр корпоративных устройств
CREATE TABLE "SchoolAsset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "location" TEXT,
    "networkId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable · политика доступа школы (AR-188)
CREATE TABLE "SchoolAccessPolicy" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionLimits" JSONB NOT NULL DEFAULT '{}',
    "incidentAt" TIMESTAMP(3),
    "incidentBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolAccessPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchoolNetwork_workspaceId_idx" ON "SchoolNetwork"("workspaceId");

-- CreateIndex
CREATE INDEX "SchoolAsset_workspaceId_idx" ON "SchoolAsset"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolAccessPolicy_workspaceId_key" ON "SchoolAccessPolicy"("workspaceId");
