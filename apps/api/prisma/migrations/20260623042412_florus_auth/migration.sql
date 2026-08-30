-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "florusOrgId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "florusUserId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "florusRole" TEXT NOT NULL,
    "subRole" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "sid" TEXT NOT NULL,
    "florusUserId" TEXT NOT NULL,
    "florusSid" TEXT,
    "orgId" TEXT,
    "florusOrgId" TEXT,
    "role" TEXT NOT NULL,
    "subRole" TEXT,
    "name" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("sid")
);

-- CreateIndex
CREATE UNIQUE INDEX "Membership_florusUserId_orgId_key" ON "Membership"("florusUserId", "orgId");

-- CreateIndex
CREATE INDEX "Session_florusUserId_idx" ON "Session"("florusUserId");

-- CreateIndex
CREATE INDEX "Session_florusSid_idx" ON "Session"("florusSid");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_florusOrgId_key" ON "Organization"("florusOrgId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

