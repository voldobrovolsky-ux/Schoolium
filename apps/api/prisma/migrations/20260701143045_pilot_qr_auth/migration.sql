-- CreateTable
CREATE TABLE "PilotInvite" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "displayName" TEXT,
    "token" TEXT NOT NULL,
    "phone" TEXT,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'invited',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PilotInvite_token_key" ON "PilotInvite"("token");

-- CreateIndex
CREATE INDEX "PilotInvite_workspaceId_idx" ON "PilotInvite"("workspaceId");
