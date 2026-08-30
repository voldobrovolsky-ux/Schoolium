-- Начало первого урока (минуты от полуночи, 540 = 9:00): времена уроков и
-- перемен в дневнике и расписании (правка владельца 2026-08-30).
ALTER TABLE "SchoolState" ADD COLUMN "dayStartMin" INTEGER NOT NULL DEFAULT 540;
ALTER TABLE "ScheduleTemplate" ADD COLUMN "dayStartMin" INTEGER NOT NULL DEFAULT 540;
