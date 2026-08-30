-- CreateTable
CREATE TABLE "JournalCell" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "disciplineId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "workType" TEXT,
    "period" TEXT,
    "postedBy" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalCell_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JournalCell_workspaceId_classId_disciplineId_period_idx" ON "JournalCell"("workspaceId", "classId", "disciplineId", "period");

-- CreateIndex
CREATE INDEX "JournalCell_workspaceId_studentId_idx" ON "JournalCell"("workspaceId", "studentId");
