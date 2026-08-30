import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SchoolState } from '@edustore/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { SchoolError } from './schoolium.errors';

/**
 * Регистр школы: состояние онбординга (AR-72) и версии агрегатов (AR-109).
 *
 * **Состояние ВЫВОДИТСЯ из данных, а не хранится второй копией.** Двух писателей
 * у него быть не может по построению: `classes_created` — это «классы есть»,
 * `load_set` — «у каждой привязки проставлены часы». Хранится только то, чего в
 * данных нет: параметры дня, явный отказ от приоритетов и счётчики версий.
 *
 * **Версия агрегата** ставится ровно на четырёх мутациях, где расхождение стоит
 * данных или пересборки (AR-109): `POST /classes/bulk` — на контингенте;
 * `PUT /schedule/load`, `PUT /schedule/day-params`, `POST /schedule/confirm` — на
 * расписании. Остальные мутации адресны либо идемпотентны, и там побеждает
 * последняя запись — это записанный выбор, а не умолчание.
 */
@Injectable()
export class SchoolStateService {
  constructor(private readonly prisma: PrismaService) {}

  /** Регистр школы; создаётся лениво — у пустой школы он не отличается от дефолта. */
  async register(workspaceId?: string) {
    const ws = workspaceId ?? TenantContext.require();
    const found = await this.prisma.schoolState.findUnique({ where: { workspaceId: ws } });
    if (found) return found;
    return this.prisma.schoolState.create({ data: { workspaceId: ws } });
  }

  /**
   * Условная запись по версии агрегата. Расхождение — `CONCURRENT_EDIT` с именем
   * второго модератора и предложением перечитать экран (`70-screens.md` §9).
   */
  async checkVersion(kind: 'contingent' | 'schedule', expected: number): Promise<void> {
    const reg = await this.register();
    const actual = kind === 'contingent' ? reg.contingentVersion : reg.scheduleVersion;
    if (expected !== actual) {
      throw new SchoolError('CONCURRENT_EDIT', { editor: reg.lastEditorName ?? 'другой модератор' });
    }
  }

  /** Инкремент версии агрегата вместе с именем того, кто её сдвинул. */
  async bump(
    tx: Prisma.TransactionClient,
    kind: 'contingent' | 'schedule',
    editor: { id: string; name: string },
    workspaceId?: string,
  ): Promise<void> {
    const ws = workspaceId ?? TenantContext.require();
    const data = kind === 'contingent'
      ? { contingentVersion: { increment: 1 } }
      : { scheduleVersion: { increment: 1 } };
    await tx.schoolState.upsert({
      where: { workspaceId: ws },
      update: { ...data, lastEditorId: editor.id, lastEditorName: editor.name },
      create: { workspaceId: ws, lastEditorId: editor.id, lastEditorName: editor.name },
    });
  }

  /**
   * Состояние онбординга перечислением сверху вниз: терминал `ready` побеждает
   * любое предыдущее, `stale` — плашка над готовой школой, `empty` — дно.
   */
  async resolve(workspaceId?: string): Promise<SchoolState> {
    const ws = workspaceId ?? TenantContext.require();
    const where = { workspaceId: ws };
    const [template, reg, classes, students, subjects, bindings, terms, staff] = await Promise.all([
      this.prisma.scheduleTemplate.findFirst({ where, orderBy: { generatedAt: 'desc' } }),
      this.prisma.schoolState.findUnique({ where: { workspaceId: ws } }),
      this.prisma.schoolClass.findMany({ where }),
      this.prisma.schoolStudent.findMany({ where }),
      this.prisma.schoolSubject.findMany({ where }),
      this.prisma.teacherBinding.findMany({ where }),
      this.prisma.term.count({ where }),
      this.prisma.staffCard.count({ where: { ...where, userId: { not: null } } }),
    ]);

    // Терминал и его окрестности читаются напрямую по статусу шаблона.
    if (template?.status === 'confirmed') return 'ready';
    if (template?.status === 'stale') return 'stale';
    if (template?.status === 'draft') return 'generated';

    // Мастер НАПРАВЛЕННЫЙ (AR-72): состояние — последний ПОСЛЕДОВАТЕЛЬНО пройденный
    // шаг, а не любой выполненный признак. Лестница, а не набор флагов: иначе
    // школа, у которой bootstrap завёл карточку модератора, объявлялась бы
    // «персонал активирован» ещё до первого класса.
    const ladder: [SchoolState, boolean][] = [
      ['classes_created', classes.length > 0],
      ['students_filled', students.length > 0 && students.every((s) => s.lastName !== '' && s.firstName !== '' && s.sex !== null)],
      ['subjects_created', subjects.length > 0],
      // активация персонала — карточки СВЕРХ той, что завёл bootstrap первому
      // модератору: он приходит платформенной операцией, а не онбордингом (AR-93)
      ['staff_activated', staff > 1],
      ['teachers_bound', subjects.length > 0 && subjects.every((s) => coverageComplete(s.id, classes, subjects, bindings))],
      ['terms_set', terms === 4],
      ['load_set', bindings.length > 0 && bindings.every((b) => b.hoursPerWeek > 0)],
      ['priorities_set', reg?.prioritiesSet === true],
      ['day_params_set', reg?.dayParamsSet === true],
    ];
    let current: SchoolState = 'empty';
    for (const [name, done] of ladder) {
      if (!done) break;
      current = name;
    }
    return current;
  }
}

/**
 * Предмет закрыт, когда покрытие полное: весь класс либо каждая группа имеет
 * педагога. Полуприкрытый предмет — это `SUBJECT_UNCOVERED` на генерации, а не
 * «почти готово».
 */
export function coverageComplete(
  subjectId: string,
  classes: { id: string; groupCount: number }[],
  subjects: { id: string; classId: string }[],
  bindings: { subjectId: string; scope: string; groupNos: number[] }[],
): boolean {
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) return false;
  const cls = classes.find((c) => c.id === subject.classId);
  const own = bindings.filter((b) => b.subjectId === subjectId);
  if (own.some((b) => b.scope === 'class')) return true;
  const groups = cls?.groupCount ?? 0;
  if (groups === 0) return false; // без групп покрыть можно только «весь класс»
  const covered = new Set(own.filter((b) => b.scope === 'group').flatMap((b) => b.groupNos));
  for (let g = 1; g <= groups; g += 1) if (!covered.has(g)) return false;
  return true;
}

/** Непокрытые группы предмета — для текста `SUBJECT_UNCOVERED` с цифрами. */
export function uncoveredGroups(
  subjectId: string,
  groupCount: number,
  bindings: { subjectId: string; scope: string; groupNos: number[] }[],
): number[] {
  const own = bindings.filter((b) => b.subjectId === subjectId);
  if (own.some((b) => b.scope === 'class')) return [];
  if (groupCount === 0) return own.length ? [] : [0];
  const covered = new Set(own.filter((b) => b.scope === 'group').flatMap((b) => b.groupNos));
  const out: number[] = [];
  for (let g = 1; g <= groupCount; g += 1) if (!covered.has(g)) out.push(g);
  return out;
}
