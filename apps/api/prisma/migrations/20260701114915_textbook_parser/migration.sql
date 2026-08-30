-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "disciplineId" TEXT NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TextbookTopic" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TextbookTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TextbookCard" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "topicId" TEXT,
    "fileId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TextbookCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Material_fileId_key" ON "Material"("fileId");

-- CreateIndex
CREATE INDEX "Material_workspaceId_disciplineId_idx" ON "Material"("workspaceId", "disciplineId");

-- CreateIndex
CREATE INDEX "TextbookTopic_workspaceId_materialId_order_idx" ON "TextbookTopic"("workspaceId", "materialId", "order");

-- CreateIndex
CREATE INDEX "TextbookCard_workspaceId_materialId_order_idx" ON "TextbookCard"("workspaceId", "materialId", "order");

-- AddForeignKey
ALTER TABLE "TextbookTopic" ADD CONSTRAINT "TextbookTopic_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TextbookCard" ADD CONSTRAINT "TextbookCard_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TextbookCard" ADD CONSTRAINT "TextbookCard_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "TextbookTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
