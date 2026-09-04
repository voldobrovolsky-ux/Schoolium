import type { PrismaClient } from '@prisma/client';
import { canonicalSubjectName, subjectNameKey, weeklyOfYear } from '@edustore/shared';
import { SUBJECT_PRESET } from './subject-preset';

/**
 * Слияние регистровых дублей карточек предмета (AR-201) — чистые функции без
 * Nest-контекста: их зовёт платформенный скрипт `school-subjects-merge.ts`
 * (прямой PrismaClient, как `schedule-clear`) и ворота G-85 (`subjects-check`).
 *
 * Карточка — пара «предмет × класс»; дубль — вторая карточка того же класса с
 * тем же ключом имени (`subjectNameKey`). Все запросы фильтруются `workspaceId`
 * явно: скрипт идёт мимо tenant-guard, а на сервере две школы.
 *
 * Событий слияние не издаёт (решение AR-201): `subject.card.deleted.v1` уронил
 * бы сетку в `stale`, хотя укладка не изменилась — вместо события поднимается
 * версия сетки и печатается план.
 */

const PRESET_NAMES = SUBJECT_PRESET.map((p) => p.name);

// ─────────────── строки импорта одного ключа ───────────────

export interface ImportSubjectRow {
  class: number;
  name: string;
  hours: number;
  teachers: string[];
}

/**
 * Импорт (`school-import.ts`): строки JSON одного ключа «класс × имя»
 * объединяются в одну карточку — педагоги объединяются, часы берутся
 * максимумом, имя — каноническое (AR-201). Порядок первых вхождений сохраняется.
 */
export function mergeImportSubjectRows<T extends ImportSubjectRow>(rows: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const key = `${row.class}·${subjectNameKey(row.name)}`;
    const hit = byKey.get(key);
    if (!hit) {
      byKey.set(key, { ...row, name: canonicalSubjectName(row.name, PRESET_NAMES), teachers: [...new Set(row.teachers)] });
      continue;
    }
    hit.teachers = [...new Set([...hit.teachers, ...row.teachers])];
    hit.hours = Math.max(hit.hours, row.hours);
  }
  return [...byKey.values()];
}

// ─────────────── поиск дублей школы ───────────────

export interface DuplicateCard {
  id: string;
  name: string;
  nameKey: string;
  priority: boolean;
  createdAt: Date;
  bindings: number;
  lessons: number;
}

export interface DuplicateGroup {
  classId: string;
  classLabel: string;
  nameKey: string;
  /** Канон — с бóльшим числом привязок, затем с уроками, затем старшая (AR-201). */
  canon: DuplicateCard;
  dups: DuplicateCard[];
}

/** Ключ карточки: хранимый `nameKey`, у строк до бэкфилла — вычисленный. */
export const cardKey = (s: { name: string; nameKey: string | null }): string => s.nameKey ?? subjectNameKey(s.name);

export async function findDuplicateGroups(prisma: PrismaClient, workspaceId: string): Promise<DuplicateGroup[]> {
  const [subjects, classes, lessonCounts] = await Promise.all([
    prisma.schoolSubject.findMany({ where: { workspaceId }, include: { bindings: { select: { id: true } } } }),
    prisma.schoolClass.findMany({ where: { workspaceId }, select: { id: true, label: true } }),
    prisma.schoolLesson.groupBy({ by: ['subjectId'], where: { workspaceId }, _count: { _all: true } }),
  ]);
  const lessonsOf = new Map(lessonCounts.map((l) => [l.subjectId, l._count._all]));
  const labelOf = new Map(classes.map((c) => [c.id, c.label]));

  const groups = new Map<string, DuplicateCard[]>();
  for (const s of subjects) {
    const key = `${s.classId}·${cardKey(s)}`;
    const card: DuplicateCard = {
      id: s.id,
      name: s.name,
      nameKey: cardKey(s),
      priority: s.priority,
      createdAt: s.createdAt,
      bindings: s.bindings.length,
      lessons: lessonsOf.get(s.id) ?? 0,
    };
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }

  const out: DuplicateGroup[] = [];
  for (const [key, cards] of groups) {
    if (cards.length < 2) continue;
    const classId = key.slice(0, key.indexOf('·'));
    const sorted = [...cards].sort(
      (a, b) => b.bindings - a.bindings || b.lessons - a.lessons || a.createdAt.getTime() - b.createdAt.getTime(),
    );
    out.push({ classId, classLabel: labelOf.get(classId) ?? '—', nameKey: sorted[0].nameKey, canon: sorted[0], dups: sorted.slice(1) });
  }
  return out.sort((a, b) => a.classLabel.localeCompare(b.classLabel, 'ru') || a.nameKey.localeCompare(b.nameKey, 'ru'));
}

// ─────────────── слияние пары ───────────────

export interface MergePlan {
  canonId: string;
  dupId: string;
  /** Имя канона после слияния — `canonicalSubjectName`. */
  canonName: string;
  priority: boolean;
  /** Привязки дубля: перенесены на канон / слиты с одинаковыми (часы — максимум). */
  bindingsMoved: number;
  bindingsDeduped: number;
  /** Строки «педагог: часы канона → часы после» — печать dry-run, риск удвоения (AR-201). */
  hours: string[];
  slots: number;
  lessons: number;
  columns: number;
  tokens: number;
}

export interface MergeResult {
  /** `false` — пара пропущена (Д6-конфликт, разные классы, карточка не найдена); причина в `skipped`. */
  ok: boolean;
  skipped?: string;
  applied: boolean;
  plan?: MergePlan;
}

interface BindingRow {
  id: string;
  teacherId: string;
  scope: string;
  groupNos: number[];
  hoursPerWeek: number;
  hoursPerYear: number;
}

const sameGroups = (a: number[], b: number[]): boolean => {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((x, i) => x === sb[i]);
};

const describe = (b: BindingRow): string => (b.scope === 'group' ? `гр. ${b.groupNos.join(', ')}` : 'весь класс');

/**
 * Слить дубль `dupId` в канон `canonId` одной транзакцией (AR-201). `dryRun` —
 * только план, ни одной записи. Порядок внутри транзакции важен: привязки и
 * ссылки по значению переезжают ДО удаления дубля, имя канона правится ПОСЛЕ —
 * уникальность `[workspaceId, name, classId]` иначе упала бы на имени дубля.
 */
export async function mergeSubjectPair(
  prisma: PrismaClient,
  workspaceId: string,
  canonId: string,
  dupId: string,
  opts: { dryRun: boolean },
): Promise<MergeResult> {
  const [canon, dup] = await Promise.all([
    prisma.schoolSubject.findFirst({ where: { id: canonId, workspaceId }, include: { bindings: true } }),
    prisma.schoolSubject.findFirst({ where: { id: dupId, workspaceId }, include: { bindings: true } }),
  ]);
  if (!canon || !dup) return { ok: false, applied: false, skipped: 'карточка не найдена в этой школе' };
  if (canon.id === dup.id) return { ok: false, applied: false, skipped: 'канон и дубль — одна карточка' };
  if (canon.classId !== dup.classId) return { ok: false, applied: false, skipped: 'карточки разных классов — не дубли' };
  if (cardKey(canon) !== cardKey(dup)) return { ok: false, applied: false, skipped: 'разный ключ имени — не дубли' };

  // Имена педагогов — для плана человеку (`User` — справочник, вне изоляции тенанта).
  const teacherIds = [...new Set([...canon.bindings, ...dup.bindings].map((b) => b.teacherId))];
  const users = teacherIds.length
    ? await prisma.user.findMany({ where: { id: { in: teacherIds } }, select: { id: true, displayName: true } })
    : [];
  const nameOf = (id: string): string => users.find((u) => u.id === id)?.displayName ?? id;

  // Д6: «весь класс» и группы на одной карточке взаимоисключены — такую пару
  // автоматически сливать нельзя, решает человек.
  const canonScopes = new Set(canon.bindings.map((b) => b.scope));
  const dupScopes = new Set(dup.bindings.map((b) => b.scope));
  if ((canonScopes.has('class') && dupScopes.has('group')) || (canonScopes.has('group') && dupScopes.has('class'))) {
    const show = (name: string, rows: BindingRow[]) => `«${name}»: ${rows.map((b) => `${nameOf(b.teacherId)} (${describe(b)})`).join(', ')}`;
    return {
      ok: false,
      applied: false,
      skipped: `Д6-конфликт класс↔группы между дублями — ${show(canon.name, canon.bindings)}; ${show(dup.name, dup.bindings)}`,
    };
  }

  // Привязки дубля: одинаковые (педагог + скоуп + группы) сливаются с часами
  // максимумом, остальные переезжают на канон.
  const moves: string[] = [];
  const dedups: { dupBindingId: string; canonBindingId: string; hoursPerYear: number; hoursPerWeek: number }[] = [];
  const hours: string[] = [];
  for (const b of dup.bindings) {
    const twin = canon.bindings.find((c) => c.teacherId === b.teacherId && c.scope === b.scope && sameGroups(c.groupNos, b.groupNos));
    if (!twin) {
      moves.push(b.id);
      continue;
    }
    const hoursPerYear = Math.max(twin.hoursPerYear, b.hoursPerYear);
    const hoursPerWeek = hoursPerYear > 0 ? weeklyOfYear(hoursPerYear) : Math.max(twin.hoursPerWeek, b.hoursPerWeek);
    dedups.push({ dupBindingId: b.id, canonBindingId: twin.id, hoursPerYear, hoursPerWeek });
    if (twin.hoursPerYear !== b.hoursPerYear) {
      hours.push(`${nameOf(b.teacherId)} (${describe(b)}): ${twin.hoursPerYear} и ${b.hoursPerYear} ч/год → ${hoursPerYear}`);
    }
  }

  const byDup = { workspaceId, subjectId: dup.id };
  const [slots, lessons, columns, tokens] = await Promise.all([
    prisma.templateSlot.count({ where: byDup }),
    prisma.schoolLesson.count({ where: byDup }),
    prisma.journalColumn.count({ where: byDup }),
    prisma.activationToken.count({ where: { workspaceId, purpose: 'subject_bind', targetId: dup.id } }),
  ]);

  const plan: MergePlan = {
    canonId: canon.id,
    dupId: dup.id,
    canonName: canonicalSubjectName(canon.name, PRESET_NAMES),
    priority: canon.priority || dup.priority,
    bindingsMoved: moves.length,
    bindingsDeduped: dedups.length,
    hours,
    slots,
    lessons,
    columns,
    tokens,
  };
  if (opts.dryRun) return { ok: true, applied: false, plan };

  await prisma.$transaction(async (tx) => {
    for (const d of dedups) {
      await tx.teacherBinding.update({ where: { id: d.canonBindingId }, data: { hoursPerYear: d.hoursPerYear, hoursPerWeek: d.hoursPerWeek } });
      await tx.teacherBinding.delete({ where: { id: d.dupBindingId } });
    }
    if (moves.length) {
      await tx.teacherBinding.updateMany({ where: { id: { in: moves }, workspaceId }, data: { subjectId: canon.id } });
    }
    // Ссылки по значению: обе стороны ключа урока (`TemplateSlot` и `SchoolLesson`)
    // обязаны переехать вместе — иначе следующий confirm отвяжет уроки (lessonKey).
    await tx.templateSlot.updateMany({ where: byDup, data: { subjectId: canon.id } });
    await tx.schoolLesson.updateMany({ where: byDup, data: { subjectId: canon.id } });
    await tx.journalColumn.updateMany({ where: byDup, data: { subjectId: canon.id } });
    await tx.activationToken.updateMany({
      where: { workspaceId, purpose: 'subject_bind', targetId: dup.id },
      data: { targetId: canon.id },
    });
    await tx.schoolSubject.delete({ where: { id: dup.id } });
    await tx.schoolSubject.update({
      where: { id: canon.id },
      data: { name: plan.canonName, nameKey: subjectNameKey(plan.canonName), priority: plan.priority },
    });
    // Версия сетки: открытые экраны не сохранят старое поверх (как schedule-clear).
    await tx.schoolState.updateMany({ where: { workspaceId }, data: { scheduleVersion: { increment: 1 } } });
  });
  return { ok: true, applied: true, plan };
}

/** Строки плана для печати — общие для скрипта и лога ворот. */
export function describePlan(group: DuplicateGroup, dup: DuplicateCard, r: MergeResult): string[] {
  const head = `${group.classLabel} · «${group.canon.name}» ← «${dup.name}»`;
  if (!r.ok || !r.plan) return [`${head}: ПРОПУЩЕНО — ${r.skipped ?? 'без причины'}`];
  const p = r.plan;
  const lines = [
    `${head} → «${p.canonName}»${p.priority ? ' (в начало дня)' : ''}`,
    `    привязок перенесено ${p.bindingsMoved}, слито одинаковых ${p.bindingsDeduped}; слотов сетки ${p.slots}, уроков ${p.lessons}, колонок журнала ${p.columns}, токенов ${p.tokens}`,
  ];
  for (const h of p.hours) lines.push(`    часы: ${h}`);
  return lines;
}
