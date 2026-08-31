-- AR-180: нормы часов вводятся ГОДОМ; недельные — производная weeklyOfYear.
-- Существующим привязкам год восстанавливается из недельных часов (×34),
-- чтобы экран завуча не встретил нули там, где нагрузка уже задана.
ALTER TABLE "TeacherBinding" ADD COLUMN "hoursPerYear" INTEGER NOT NULL DEFAULT 0;
UPDATE "TeacherBinding" SET "hoursPerYear" = "hoursPerWeek" * 34 WHERE "hoursPerWeek" > 0;
