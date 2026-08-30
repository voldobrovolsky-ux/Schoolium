-- CreateTable
CREATE TABLE "CompetencyNode" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fgosArCode" TEXT NOT NULL,
    "disciplineId" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "CompetencyNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterestNode" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "InterestNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasteryEdge" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "competencyNodeId" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "signalRefs" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasteryEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterestEdge" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "interestNodeId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "InterestEdge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompetencyNode_workspaceId_idx" ON "CompetencyNode"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetencyNode_workspaceId_fgosArCode_disciplineId_key" ON "CompetencyNode"("workspaceId", "fgosArCode", "disciplineId");

-- CreateIndex
CREATE INDEX "InterestNode_workspaceId_idx" ON "InterestNode"("workspaceId");

-- CreateIndex
CREATE INDEX "MasteryEdge_workspaceId_studentId_idx" ON "MasteryEdge"("workspaceId", "studentId");

-- CreateIndex
CREATE INDEX "MasteryEdge_workspaceId_competencyNodeId_idx" ON "MasteryEdge"("workspaceId", "competencyNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "MasteryEdge_workspaceId_studentId_competencyNodeId_key" ON "MasteryEdge"("workspaceId", "studentId", "competencyNodeId");

-- CreateIndex
CREATE INDEX "InterestEdge_workspaceId_studentId_idx" ON "InterestEdge"("workspaceId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "InterestEdge_workspaceId_studentId_interestNodeId_key" ON "InterestEdge"("workspaceId", "studentId", "interestNodeId");

-- AddForeignKey
ALTER TABLE "MasteryEdge" ADD CONSTRAINT "MasteryEdge_competencyNodeId_fkey" FOREIGN KEY ("competencyNodeId") REFERENCES "CompetencyNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterestEdge" ADD CONSTRAINT "InterestEdge_interestNodeId_fkey" FOREIGN KEY ("interestNodeId") REFERENCES "InterestNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
