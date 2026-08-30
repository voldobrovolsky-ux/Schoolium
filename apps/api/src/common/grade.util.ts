import type { GradeValue } from '@edustore/shared';

/** Русские сокращения дней недели (Mon=0..Sun=6 после нормализации getDay). */
const WEEKDAYS_RU = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

/** "пн".."вс" для даты. */
export function ruWeekday(date: Date): string {
  // JS getDay(): 0=вс..6=сб → сдвигаем к понедельнику.
  const idx = (date.getDay() + 6) % 7;
  return WEEKDAYS_RU[idx];
}

/** "DD.MM" (день.месяц с ведущими нулями). */
export function formatDay(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}`;
}

/** Запись оценки (value/absent) → значение ячейки журнала. */
export function gradeToCell(
  grade: { value: number | null; absent: boolean } | null | undefined,
): GradeValue {
  if (!grade) return '';
  if (grade.absent) return 'н';
  if (grade.value === null) return '';
  return String(grade.value) as GradeValue;
}

/** Значение ячейки → поля Prisma {value, absent} или null (удалить запись). */
export function cellToGradeData(
  value: GradeValue,
): { value: number | null; absent: boolean } | null {
  if (value === '') return null; // удалить оценку
  if (value === 'н') return { value: null, absent: true };
  const num = Number(value);
  return { value: num, absent: false };
}

/** Средний балл по значениям ячеек: "4.2" | "—". */
export function rowAverage(grades: GradeValue[]): string {
  let sum = 0;
  let cnt = 0;
  for (const g of grades) {
    if (g && g !== 'н') {
      sum += Number(g);
      cnt += 1;
    }
  }
  return cnt ? (sum / cnt).toFixed(1) : '—';
}
