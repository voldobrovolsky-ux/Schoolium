-- CreateEnum
CREATE TYPE "KtpStatus" AS ENUM ('draft', 'approved');

-- CreateEnum
CREATE TYPE "KppStatus" AS ENUM ('scheduled', 'approved');

-- CreateEnum
CREATE TYPE "LessonMode" AS ENUM ('auto', 'hybrid', 'manual');

-- CreateEnum
CREATE TYPE "LessonState" AS ENUM ('idle', 'running', 'done');

-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "kppLessonId" TEXT,
ADD COLUMN     "mode" "LessonMode" NOT NULL DEFAULT 'manual',
ADD COLUMN     "phase" TEXT,
ADD COLUMN     "state" "LessonState" NOT NULL DEFAULT 'idle',
ADD COLUMN     "t0" TIMESTAMP(3),
ADD COLUMN     "teacherId" TEXT;

-- CreateTable
CREATE TABLE "Ktp" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "disciplineId" TEXT NOT NULL,
    "status" "KtpStatus" NOT NULL DEFAULT 'draft',
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ktp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KtpTopic" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ktpId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "fgosHours" INTEGER NOT NULL,
    "arCodes" TEXT[],
    "title" TEXT NOT NULL,

    CONSTRAINT "KtpTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Timetable" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'engine',
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Timetable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimetableSlot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "timetableId" TEXT NOT NULL,
    "day" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "durationMin" INTEGER NOT NULL,

    CONSTRAINT "TimetableSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Kpp" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "disciplineId" TEXT NOT NULL,
    "status" "KppStatus" NOT NULL DEFAULT 'scheduled',
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Kpp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KppLesson" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kppId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "sequenceNo" INTEGER NOT NULL,
    "plannedContent" JSONB,

    CONSTRAINT "KppLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KppMapping" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kppLessonId" TEXT NOT NULL,
    "timetableSlotId" TEXT NOT NULL,

    CONSTRAINT "KppMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Ktp_workspaceId_classId_disciplineId_idx" ON "Ktp"("workspaceId", "classId", "disciplineId");

-- CreateIndex
CREATE INDEX "KtpTopic_workspaceId_ktpId_order_idx" ON "KtpTopic"("workspaceId", "ktpId", "order");

-- CreateIndex
CREATE INDEX "Timetable_workspaceId_classId_idx" ON "Timetable"("workspaceId", "classId");

-- CreateIndex
CREATE INDEX "TimetableSlot_workspaceId_timetableId_day_position_idx" ON "TimetableSlot"("workspaceId", "timetableId", "day", "position");

-- CreateIndex
CREATE INDEX "Kpp_workspaceId_classId_disciplineId_idx" ON "Kpp"("workspaceId", "classId", "disciplineId");

-- CreateIndex
CREATE INDEX "KppLesson_workspaceId_kppId_sequenceNo_idx" ON "KppLesson"("workspaceId", "kppId", "sequenceNo");

-- CreateIndex
CREATE UNIQUE INDEX "KppMapping_kppLessonId_key" ON "KppMapping"("kppLessonId");

-- CreateIndex
CREATE INDEX "KppMapping_workspaceId_timetableSlotId_idx" ON "KppMapping"("workspaceId", "timetableSlotId");

-- CreateIndex
CREATE INDEX "Lesson_workspaceId_teacherId_date_idx" ON "Lesson"("workspaceId", "teacherId", "date");

-- CreateIndex
CREATE INDEX "Lesson_kppLessonId_idx" ON "Lesson"("kppLessonId");

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_kppLessonId_fkey" FOREIGN KEY ("kppLessonId") REFERENCES "KppLesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KtpTopic" ADD CONSTRAINT "KtpTopic_ktpId_fkey" FOREIGN KEY ("ktpId") REFERENCES "Ktp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_timetableId_fkey" FOREIGN KEY ("timetableId") REFERENCES "Timetable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KppLesson" ADD CONSTRAINT "KppLesson_kppId_fkey" FOREIGN KEY ("kppId") REFERENCES "Kpp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KppLesson" ADD CONSTRAINT "KppLesson_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "KtpTopic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KppMapping" ADD CONSTRAINT "KppMapping_kppLessonId_fkey" FOREIGN KEY ("kppLessonId") REFERENCES "KppLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KppMapping" ADD CONSTRAINT "KppMapping_timetableSlotId_fkey" FOREIGN KEY ("timetableSlotId") REFERENCES "TimetableSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
