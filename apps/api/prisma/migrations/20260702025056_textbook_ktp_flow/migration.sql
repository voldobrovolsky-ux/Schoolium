-- AlterTable
ALTER TABLE "KtpTopic" ADD COLUMN     "hoursSource" TEXT;

-- AlterTable
ALTER TABLE "Material" ADD COLUMN     "classId" TEXT;

-- AlterTable
ALTER TABLE "TextbookCard" ADD COLUMN     "ktpTopicId" TEXT;

-- CreateTable
CREATE TABLE "LessonContent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kppLessonId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "LessonContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceSettings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "parserProvider" TEXT NOT NULL DEFAULT 'regexp',
    "parserEndpointUrl" TEXT,
    "parserApiKeyEnc" TEXT,
    "parserModelName" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LessonContent_workspaceId_kppLessonId_order_idx" ON "LessonContent"("workspaceId", "kppLessonId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "LessonContent_kppLessonId_cardId_key" ON "LessonContent"("kppLessonId", "cardId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceSettings_workspaceId_key" ON "WorkspaceSettings"("workspaceId");

-- CreateIndex
CREATE INDEX "Material_workspaceId_classId_disciplineId_idx" ON "Material"("workspaceId", "classId", "disciplineId");

-- CreateIndex
CREATE INDEX "TextbookCard_ktpTopicId_idx" ON "TextbookCard"("ktpTopicId");

-- AddForeignKey
ALTER TABLE "LessonContent" ADD CONSTRAINT "LessonContent_kppLessonId_fkey" FOREIGN KEY ("kppLessonId") REFERENCES "KppLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonContent" ADD CONSTRAINT "LessonContent_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "TextbookCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TextbookCard" ADD CONSTRAINT "TextbookCard_ktpTopicId_fkey" FOREIGN KEY ("ktpTopicId") REFERENCES "KtpTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
