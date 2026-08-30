-- CreateTable
CREATE TABLE "AssessmentPolicy" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "classId" TEXT,
    "disciplineId" TEXT,
    "items" JSONB,
    "coefficients" JSONB,
    "scale" JSONB,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimingProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "lessonType" TEXT NOT NULL,
    "thresholds" JSONB,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgStandards" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "lessonLengthMin" INTEGER NOT NULL DEFAULT 45,
    "sparki" JSONB,
    "orderRules" JSONB,
    "fizminutki" JSONB,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgStandards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FgosHours" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "disciplineId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "hours" INTEGER NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FgosHours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssessmentPolicy_workspaceId_scope_idx" ON "AssessmentPolicy"("workspaceId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "TimingProfile_workspaceId_lessonType_key" ON "TimingProfile"("workspaceId", "lessonType");

-- CreateIndex
CREATE UNIQUE INDEX "OrgStandards_workspaceId_key" ON "OrgStandards"("workspaceId");

-- CreateIndex
CREATE INDEX "FgosHours_workspaceId_idx" ON "FgosHours"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "FgosHours_workspaceId_classId_disciplineId_key" ON "FgosHours"("workspaceId", "classId", "disciplineId");
