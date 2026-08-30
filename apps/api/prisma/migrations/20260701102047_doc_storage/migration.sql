-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'личное',
    "audience" TEXT NOT NULL DEFAULT 'staff',
    "kind" TEXT NOT NULL DEFAULT 'file',
    "mime" TEXT,
    "size" INTEGER,
    "textExtract" TEXT,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "status" TEXT,
    "crdtState" BYTEA,
    "disciplineId" TEXT,
    "classId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "no" INTEGER NOT NULL,
    "s3Key" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "dim" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lens" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "filter" JSONB NOT NULL,

    CONSTRAINT "Lens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionFile" (
    "collectionId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "CollectionFile_pkey" PRIMARY KEY ("collectionId","fileId")
);

-- CreateTable
CREATE TABLE "ShareGrant" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "granteeId" TEXT,
    "linkToken" TEXT,
    "level" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "File_workspaceId_scope_audience_idx" ON "File"("workspaceId", "scope", "audience");

-- CreateIndex
CREATE INDEX "File_workspaceId_disciplineId_idx" ON "File"("workspaceId", "disciplineId");

-- CreateIndex
CREATE INDEX "DocVersion_workspaceId_fileId_idx" ON "DocVersion"("workspaceId", "fileId");

-- CreateIndex
CREATE UNIQUE INDEX "DocVersion_fileId_no_key" ON "DocVersion"("fileId", "no");

-- CreateIndex
CREATE INDEX "Tag_workspaceId_fileId_idx" ON "Tag"("workspaceId", "fileId");

-- CreateIndex
CREATE INDEX "Tag_workspaceId_dim_value_idx" ON "Tag"("workspaceId", "dim", "value");

-- CreateIndex
CREATE INDEX "Lens_workspaceId_idx" ON "Lens"("workspaceId");

-- CreateIndex
CREATE INDEX "Collection_workspaceId_ownerId_idx" ON "Collection"("workspaceId", "ownerId");

-- CreateIndex
CREATE INDEX "CollectionFile_workspaceId_idx" ON "CollectionFile"("workspaceId");

-- CreateIndex
CREATE INDEX "ShareGrant_workspaceId_fileId_idx" ON "ShareGrant"("workspaceId", "fileId");

-- AddForeignKey
ALTER TABLE "DocVersion" ADD CONSTRAINT "DocVersion_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionFile" ADD CONSTRAINT "CollectionFile_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareGrant" ADD CONSTRAINT "ShareGrant_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;
