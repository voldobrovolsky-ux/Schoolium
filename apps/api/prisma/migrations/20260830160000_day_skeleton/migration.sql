-- УТЦ v1.4 фаза I (AR-171, AR-172): скелет дня с явными временами позиций,
-- часовой пояс школы и маркер сетки. Существующие школы продолжают жить на
-- прежних параметрах дня (фолбэк) — данные не трогаются.

ALTER TABLE "SchoolState" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow';
ALTER TABLE "SchoolState" ADD COLUMN "gridKind" TEXT NOT NULL DEFAULT 'paired';

CREATE TABLE "SkeletonPosition" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dayNo" INTEGER NOT NULL,
    "posNo" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "lessonNo" INTEGER,
    "pairNo" INTEGER,

    CONSTRAINT "SkeletonPosition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SkeletonPosition_workspaceId_dayNo_posNo_key" ON "SkeletonPosition"("workspaceId", "dayNo", "posNo");
CREATE INDEX "SkeletonPosition_workspaceId_dayNo_idx" ON "SkeletonPosition"("workspaceId", "dayNo");
