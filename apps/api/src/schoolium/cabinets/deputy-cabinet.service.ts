import { Injectable } from '@nestjs/common';
import type { ChecklistItemDto, DeputyCabinetDto } from '@edustore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { schoolToday, schoolTodayIso } from '../calendar/school-day';
import { coverageComplete, SchoolStateService } from '../school-state.service';

/** Окно «журнал ведётся»: отметки за последние две недели — учебная неделя плюс запас на каникулы. */
const JOURNAL_WINDOW_DAYS = 14;

/**
 * Кабинет завуча `S-61` (AR-193): сводки готовности УТЦ и КПЦ. Ни один пункт
 * не хранится — каждый выведен из данных тем же способом, каким регистр школы
 * выводит состояние онбординга (AR-72): двух писателей у факта «нормы часов
 * расставлены» быть не может. Ключи пунктов ФИКСИРОВАНЫ — экран ссылается на
 * них, а не на позицию в списке.
 */
@Injectable()
export class DeputyCabinetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: SchoolStateService,
  ) {}

  async cabinet(): Promise<DeputyCabinetDto> {
    const ws = TenantContext.require();
    const today = schoolToday();
    const since = new Date(Date.now() - JOURNAL_WINDOW_DAYS * 24 * 3600 * 1000);
    const [state, reg, classes, students, subjects, bindings, terms, skeleton, templates, lessonsToday, marks, staffCards, guardianCards] =
      await Promise.all([
        this.state.resolve(ws),
        this.state.register(ws),
        this.prisma.schoolClass.findMany(),
        this.prisma.schoolStudent.findMany({ where: { deactivatedAt: null } }),
        this.prisma.schoolSubject.findMany(),
        this.prisma.teacherBinding.findMany(),
        this.prisma.term.count(),
        this.prisma.skeletonPosition.count(),
        this.prisma.scheduleTemplate.findMany({ orderBy: { generatedAt: 'desc' }, take: 1 }),
        this.prisma.schoolLesson.count({ where: { date: today, detachedAt: null } }),
        this.prisma.mark.count({ where: { postedAt: { gte: since } } }),
        this.prisma.staffCard.findMany({ where: { userId: { not: null } } }),
        this.prisma.guardianCard.findMany({ where: { userId: { not: null } } }),
      ]);
    const userIds = [...staffCards.map((c) => c.userId!), ...guardianCards.map((c) => c.userId!)];
    const memberships = userIds.length
      ? await TenantContext.runAsSystem(() =>
          this.prisma.membership.findMany({ where: { workspaceId: ws, userId: { in: userIds } } }),
        )
      : [];
    const activated = new Set(memberships.filter((m) => m.activatedAt !== null).map((m) => m.userId));
    // Уволенный (членство деактивировано) из счёта выбывает: иначе сотрудник,
    // так и не активировавший учётку до увольнения, навсегда держал бы пункт
    // «Персонал активирован» в незакрытом состоянии.
    const fired = new Set(memberships.filter((m) => m.deactivatedAt !== null).map((m) => m.userId));
    const liveStaffCards = staffCards.filter((c) => !fired.has(c.userId!));
    const liveGuardianCards = guardianCards.filter((c) => !fired.has(c.userId!));

    const covered = subjects.filter((s) => coverageComplete(s.id, classes, subjects, bindings)).length;
    const loadSet = bindings.filter((b) => b.hoursPerYear > 0).length;
    const latest = templates[0] ?? null;
    const filledStudents = students.filter((s) => s.lastName !== '' && s.firstName !== '' && s.sex !== null).length;
    const staffActivated = liveStaffCards.filter((c) => activated.has(c.userId!)).length;
    const guardiansActivated = liveGuardianCards.filter((c) => activated.has(c.userId!)).length;

    const item = (
      key: string,
      title: string,
      done: boolean,
      detail: string,
      owner: ChecklistItemDto['owner'],
      to: string,
    ): ChecklistItemDto => ({ key, title, detail, done, owner, to });

    const utc: ChecklistItemDto[] = [
      item('terms', 'Учебные периоды', terms === 4, terms === 4 ? 'четыре четверти заданы' : `задано ${terms} из 4`, 'moderator', '/schedule'),
      item('load', 'Нормы часов', bindings.length > 0 && loadSet === bindings.length, `${loadSet} из ${bindings.length}`, 'deputy', '/schedule'),
      item('skeleton', 'Скелет дня', skeleton > 0, skeleton > 0 ? `позиций: ${skeleton}` : 'скелет не задан', 'moderator', '/schedule'),
      item('dayParams', 'Параметры дня', reg.dayParamsSet, reg.dayParamsSet ? `уроков в день: ${reg.slotsPerDay}, дней: ${reg.days}` : 'не заданы', 'moderator', '/schedule'),
      item('priorities', 'Приоритеты предметов', reg.prioritiesSet, reg.prioritiesSet ? `приоритетных предметов: ${subjects.filter((s) => s.priority).length}` : 'не заданы', 'moderator', '/schedule'),
      item('generated', 'Сетка собрана', latest !== null, latest ? `последняя сборка: ${latest.generatedAt.toISOString().slice(0, 10)}` : 'сетки нет', 'moderator', '/schedule'),
      item(
        'confirmed',
        'Сетка подтверждена',
        latest?.status === 'confirmed',
        latest?.status === 'confirmed' ? 'действует' : latest?.status === 'stale' ? 'сетка устарела' : latest ? 'черновик не подтверждён' : 'сетки нет',
        'moderator',
        '/schedule',
      ),
      item('journal', 'Журнал ведётся', marks > 0, marks > 0 ? `отметок за ${JOURNAL_WINDOW_DAYS} дней: ${marks}` : `отметок за ${JOURNAL_WINDOW_DAYS} дней нет`, 'teacher', '/journal'),
    ];

    const kpc: ChecklistItemDto[] = [
      item('classes', 'Классы', classes.length > 0, classes.length > 0 ? `классов: ${classes.length}` : 'классы не созданы', 'moderator', '/classes'),
      item('students', 'Профили учеников', students.length > 0 && filledStudents === students.length, `заполнено ${filledStudents} из ${students.length}`, 'moderator', '/classes'),
      item('subjects', 'Предметы', subjects.length > 0, subjects.length > 0 ? `предметов: ${subjects.length}` : 'предметы не созданы', 'moderator', '/subjects'),
      item('bindings', 'Педагоги привязаны', subjects.length > 0 && covered === subjects.length, `покрыто ${covered} из ${subjects.length}`, 'moderator', '/subjects'),
      item('staff', 'Персонал активирован', liveStaffCards.length > 0 && staffActivated === liveStaffCards.length, `активировано ${staffActivated} из ${liveStaffCards.length}`, 'moderator', '/staff'),
      item(
        'guardians',
        'Родители активированы',
        liveGuardianCards.length > 0 && guardiansActivated === liveGuardianCards.length,
        liveGuardianCards.length === 0 ? 'родители не заведены' : `активировано ${guardiansActivated} из ${liveGuardianCards.length}`,
        'moderator',
        '/guardians',
      ),
    ];

    return {
      state,
      today: schoolTodayIso(),
      lessonsToday,
      utc,
      kpc,
      coverage: { covered, total: subjects.length },
      load: { set: loadSet, total: bindings.length },
    };
  }
}
