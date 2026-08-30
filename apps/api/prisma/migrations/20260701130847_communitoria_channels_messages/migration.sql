-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "moderators" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "scope" TEXT;

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT,
    "replyToId" TEXT,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "attachmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audience" TEXT,
    "ackDeadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageReaction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ack" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'sent',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Message_workspaceId_channelId_createdAt_id_idx" ON "Message"("workspaceId", "channelId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "MessageReaction_workspaceId_messageId_idx" ON "MessageReaction"("workspaceId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageReaction_messageId_userId_emoji_key" ON "MessageReaction"("messageId", "userId", "emoji");

-- CreateIndex
CREATE INDEX "Ack_workspaceId_announcementId_idx" ON "Ack"("workspaceId", "announcementId");

-- CreateIndex
CREATE UNIQUE INDEX "Ack_announcementId_userId_key" ON "Ack"("announcementId", "userId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ack" ADD CONSTRAINT "Ack_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
