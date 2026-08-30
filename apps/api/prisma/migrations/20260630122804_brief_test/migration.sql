-- CreateTable
CREATE TABLE "BriefTest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "itemMatrix" JSONB,
    "presentStudentCodes" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'generated',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BriefTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BriefTestCode" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "briefTestId" TEXT NOT NULL,
    "studentCode" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,

    CONSTRAINT "BriefTestCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentResult" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "briefTestId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'tesseract',

    CONSTRAINT "AssessmentResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentResultItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "assessmentResultId" TEXT NOT NULL,
    "studentCode" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "perItem" JSONB,

    CONSTRAINT "AssessmentResultItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BriefTest_workspaceId_lessonId_idx" ON "BriefTest"("workspaceId", "lessonId");

-- CreateIndex
CREATE INDEX "BriefTestCode_workspaceId_briefTestId_idx" ON "BriefTestCode"("workspaceId", "briefTestId");

-- CreateIndex
CREATE UNIQUE INDEX "BriefTestCode_briefTestId_studentCode_key" ON "BriefTestCode"("briefTestId", "studentCode");

-- CreateIndex
CREATE INDEX "AssessmentResult_workspaceId_briefTestId_idx" ON "AssessmentResult"("workspaceId", "briefTestId");

-- CreateIndex
CREATE INDEX "AssessmentResultItem_workspaceId_assessmentResultId_idx" ON "AssessmentResultItem"("workspaceId", "assessmentResultId");

-- AddForeignKey
ALTER TABLE "BriefTestCode" ADD CONSTRAINT "BriefTestCode_briefTestId_fkey" FOREIGN KEY ("briefTestId") REFERENCES "BriefTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentResult" ADD CONSTRAINT "AssessmentResult_briefTestId_fkey" FOREIGN KEY ("briefTestId") REFERENCES "BriefTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentResultItem" ADD CONSTRAINT "AssessmentResultItem_assessmentResultId_fkey" FOREIGN KEY ("assessmentResultId") REFERENCES "AssessmentResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
