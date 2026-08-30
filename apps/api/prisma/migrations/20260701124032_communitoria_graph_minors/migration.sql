-- CreateTable
CREATE TABLE "Parenthood" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "parentUserId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'florus',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Parenthood_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT,
    "classId" TEXT,
    "minorPresent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelParticipant" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT,
    "studentId" TEXT,
    "role" TEXT NOT NULL,
    "isMinor" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Parenthood_workspaceId_studentId_idx" ON "Parenthood"("workspaceId", "studentId");

-- CreateIndex
CREATE INDEX "Parenthood_workspaceId_parentUserId_idx" ON "Parenthood"("workspaceId", "parentUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Parenthood_parentUserId_studentId_key" ON "Parenthood"("parentUserId", "studentId");

-- CreateIndex
CREATE INDEX "Channel_workspaceId_kind_idx" ON "Channel"("workspaceId", "kind");

-- CreateIndex
CREATE INDEX "ChannelParticipant_workspaceId_channelId_idx" ON "ChannelParticipant"("workspaceId", "channelId");

-- AddForeignKey
ALTER TABLE "ChannelParticipant" ADD CONSTRAINT "ChannelParticipant_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
