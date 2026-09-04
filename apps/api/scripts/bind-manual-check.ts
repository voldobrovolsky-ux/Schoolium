/**
 * G-78 — **ручная привязка и компетенции педагога доказаны** (AR-177, AR-179).
 *
 * QR остаётся основным каналом; ручная привязка из карточки предмета обязана
 * давать ТОТ ЖЕ `TeacherBinding` и ТО ЖЕ событие `teacher.bound.v1`, что скан —
 * аудит и подписчики (включая устаревание сетки) канал не различают.
 *
 * Перечислением:
 *   1. ручная привязка класс-скоупом создаёт запись с теми же полями, что скан;
 *   2. событие `teacher.bound.v1` встаёт в outbox с тем же payload;
 *   3. взаимоисключение Д6 держится: групповая поверх классовой — отказ;
 *   4. пользователь без активного членства — отказ, привязка не создаётся;
 *   5. привязка видна карточке предмета (покрытие полное);
 *   6. открепление ручной привязки работает тем же `unbind`, что у скановой;
 *   7-11. компетенции (AR-179): галочка ставит класс-привязку; снятая галочка
 *   открепляет; занятая позиция без `replace` — конфликт с фамилиями и НИ
 *   ОДНОЙ мутации; с `replace` — замена (прежний откреплён, новый привязан) и
 *   события обеих операций;
 *   12. группы в компетенциях (AR-202): групповая позиция назначается
 *   `positions[].groupNos`; Д6 держится — класс поверх чужих групп и группа
 *   поверх чужого класса возвращаются конфликтом с `groupNo` без мутаций, с
 *   `replace` чужие снимаются ровно в запрошенном объёме; группа вне числа
 *   групп класса отклоняется; пустой список позиций открепляет всё; СВОЯ
 *   привязка меняет вид (класс ↔ группа) без конфликта;
 *   13. число групп класса `PUT /classes/:id/groups` (AR-202, §11 строка 50):
 *   `CONCURRENT_EDIT` по версии контингента; 0→N — группы и дефолтное
 *   разбиение учеников (AR-75), событие `contingent.class.regrouped.v1`;
 *   N→M добавляет пустые группы, состав не пересчитывает; уменьшение при
 *   педагоге на снимаемой группе — `GROUPS_BOUND` с классом и номерами;
 *   после открепления группы снимаются, ученики остаются без группы.
 *
 * Запуск: npm --workspace apps/api run bindmanual:check
 */
import { SubjectsService } from '../src/schoolium/subjects/subjects.service';
import { ContingentService } from '../src/schoolium/contingent/contingent.service';
import { SchoolStateService } from '../src/schoolium/school-state.service';
import { SCHOOL_EVENTS } from '../src/schoolium/schoolium.contract';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { bad, bench, bootstrapSchool, check, inSchool, makeStaff, refuses, report } from './schoolium/harness';

async function main(): Promise<never> {
  const b = await bench();
  const subjects = b.get(SubjectsService);
  const contingent = b.get(ContingentService);
  const state = b.get(SchoolStateService);
  const prisma = b.get(PrismaService);

  const school = await bootstrapSchool(b, 'Школа ручной привязки');
  const teacher = await makeStaff(b, school, ['teacher'], 'Петрова Анна');

  await inSchool(school.workspaceId, async () => {
    // класс и предмет — руками, без полного onboarding-конвейера
    const cls = await prisma.schoolClass.create({
      data: { workspaceId: school.workspaceId, parallel: 5, letter: 'А', label: '5А', groupCount: 0 },
    });
    const subject = await subjects.create({ name: 'Математика', classId: cls.id });

    // ---------- 1-2. привязка + событие ----------
    const bound = await subjects.bindTeacherManual(subject.id, { teacherId: teacher.userId, scope: 'class' }, school.moderator);
    check(bound.bindings.length === 1, 'ручная привязка создала ровно одну запись');
    const row = await prisma.teacherBinding.findFirst({ where: { subjectId: subject.id } });
    check(
      !!row && row.teacherId === teacher.userId && row.scope === 'class' && row.groupNos.length === 0 && row.workspaceId === school.workspaceId,
      'форма записи неотличима от скановой: workspaceId, subjectId, teacherId, scope, groupNos',
    );
    const evt = await TenantContext.runAsSystem(() =>
      prisma.outboxEvent.findFirst({
        where: { type: 'subject.teacher.bound.v1', workspaceId: school.workspaceId },
        orderBy: { createdAt: 'desc' },
      }),
    );
    const payload = (evt?.payload ?? {}) as { subjectId?: string; teacherId?: string; scope?: string };
    check(
      payload.subjectId === subject.id && payload.teacherId === teacher.userId && payload.scope === 'class',
      'событие subject.teacher.bound.v1 в outbox — payload не выдаёт канал (AR-177)',
    );

    // ---------- 3. взаимоисключение Д6 ----------
    const before = await prisma.teacherBinding.count({ where: { subjectId: subject.id } });
    let refused = false;
    await subjects
      .bindTeacherManual(subject.id, { teacherId: teacher.userId, scope: 'group', groupNos: [1] }, school.moderator)
      .catch(() => { refused = true; });
    const after = await prisma.teacherBinding.count({ where: { subjectId: subject.id } });
    check(refused && after === before, 'групповая поверх классовой отклонена — привязок не прибавилось (Д6)');

    // ---------- 4. чужак не привязывается ----------
    let alien = false;
    await subjects
      .bindTeacherManual(subject.id, { teacherId: 'нет-такого', scope: 'class' }, school.moderator)
      .catch(() => { alien = true; });
    check(alien, 'пользователь без активного членства в школе отклонён');

    // ---------- 5. карточка предмета видит привязку ----------
    const card = await subjects.get(subject.id);
    check(card.coverageComplete, 'покрытие предмета полное — карточка видит ручную привязку');

    // ---------- 6. открепление — общее ----------
    await subjects.unbind(subject.id, teacher.userId, school.moderator);
    const left = await prisma.teacherBinding.count({ where: { subjectId: subject.id } });
    check(left === 0, 'открепление ручной привязки работает тем же путём, что у скановой');

    // ---------- 7-12. компетенции (AR-179) ----------
    const second = await makeStaff(b, school, ['teacher'], 'Сидорова Ольга');
    const subj2 = await subjects.create({ name: 'Русский язык', classId: cls.id });

    // 7. галочки ставят класс-привязки разом
    const r1 = await subjects.saveCompetence({ teacherId: teacher.userId, subjectIds: [subject.id, subj2.id] }, school.moderator);
    check(r1.ok && r1.bound === 2, 'компетенции: две галочки — две класс-привязки одним заходом');

    // 8. снятая галочка открепляет
    const r2 = await subjects.saveCompetence({ teacherId: teacher.userId, subjectIds: [subject.id] }, school.moderator);
    check(r2.ok && r2.unbound === 1 && (await prisma.teacherBinding.count({ where: { subjectId: subj2.id } })) === 0,
      'компетенции: снятая галочка открепила позицию');

    // 9. занятая позиция без replace — конфликт с фамилией и ни одной мутации
    const r3 = await subjects.saveCompetence({ teacherId: second.userId, subjectIds: [subject.id] }, school.moderator);
    check(!r3.ok && (r3.conflicts?.[0]?.teacherNames ?? []).length > 0 && r3.bound === 0,
      'компетенции: занятая позиция вернулась конфликтом с фамилией, мутаций нет');
    const still = await prisma.teacherBinding.findFirst({ where: { subjectId: subject.id } });
    check(still?.teacherId === teacher.userId, 'компетенции: без replace прежний педагог на месте');

    // 10-11. replace выполняет замену и издаёт события обеих операций
    const r4 = await subjects.saveCompetence({ teacherId: second.userId, subjectIds: [subject.id], replace: true }, school.moderator);
    const nowRow = await prisma.teacherBinding.findFirst({ where: { subjectId: subject.id } });
    check(r4.ok && nowRow?.teacherId === second.userId, 'компетенции: replace заменил педагога на позиции');
    const unboundEvt = await TenantContext.runAsSystem(() =>
      prisma.outboxEvent.findFirst({
        where: { type: 'subject.teacher.unbound.v1', workspaceId: school.workspaceId },
        orderBy: { createdAt: 'desc' },
      }),
    );
    const up = (unboundEvt?.payload ?? {}) as { teacherId?: string };
    check(up.teacherId === teacher.userId, 'компетенции: замена издала teacher.unbound.v1 по прежнему педагогу');

    // 12. группы назначаются компетенцией (AR-202): групповая позиция — `positions[].groupNos`;
    //     Д6 держится (класс ↔ группы на одной карточке), конфликт — с номером группы, replace снимает чужих
    const grpCls = await prisma.schoolClass.create({
      data: { workspaceId: school.workspaceId, parallel: 6, letter: 'А', label: '6А', groupCount: 2 },
    });
    const grpSubj = await subjects.create({ name: 'Английский язык', classId: grpCls.id });
    await subjects.bindTeacherManual(grpSubj.id, { teacherId: teacher.userId, scope: 'group', groupNos: [1] }, school.moderator);
    const rowsOf = () => prisma.teacherBinding.findMany({ where: { subjectId: grpSubj.id }, orderBy: { teacherId: 'asc' } });

    // 12а. вторая группа — второму педагогу через компетенции; покрытие полное
    const r5 = await subjects.saveCompetence(
      { teacherId: second.userId, subjectIds: [], positions: [{ subjectId: grpSubj.id, groupNos: [2] }] },
      school.moderator,
    );
    const g5 = await rowsOf();
    check(
      r5.ok && r5.bound === 1 && g5.length === 2 && g5.every((b) => b.scope === 'group') &&
        g5.find((b) => b.teacherId === second.userId)?.groupNos.join() === '2',
      'компетенции: групповая позиция назначена каналом компетенций — привязка scope=group к группе 2 (AR-202)',
    );
    check((await subjects.get(grpSubj.id)).coverageComplete, 'компетенции: две группы у двух педагогов — покрытие полное');

    // 12б. чужая группа без replace — конфликт с номером группы и ни одной мутации
    const r6 = await subjects.saveCompetence(
      { teacherId: second.userId, subjectIds: [], positions: [{ subjectId: grpSubj.id, groupNos: [1, 2] }] },
      school.moderator,
    );
    const c6 = r6.conflicts?.[0];
    check(!r6.ok && c6?.groupNo === 1 && (c6?.teacherNames ?? []).includes('Петрова Анна') && r6.bound === 0,
      'компетенции: занятая группа 1 вернулась конфликтом с groupNo и фамилией, мутаций нет');
    check((await rowsOf()).length === 2, 'компетенции: без replace привязки обеих групп на месте');

    // 12в. Д6: «весь класс» поверх чужих групповых — конфликт по каждой занятой группе; классовая своя не создаётся
    const third = await makeStaff(b, school, ['teacher'], 'Кузнецова Ирина');
    const r7 = await subjects.saveCompetence({ teacherId: third.userId, subjectIds: [grpSubj.id] }, school.moderator);
    check(!r7.ok && (r7.conflicts ?? []).length === 2 && (r7.conflicts ?? []).every((c) => c.groupNo === 1 || c.groupNo === 2),
      'компетенции: «весь класс» поверх групповых — конфликт по группам 1 и 2 (Д6), мутаций нет');
    check((await rowsOf()).every((b) => b.scope === 'group'), 'компетенции: классовой привязки поверх групповых не появилось');

    // 12г. replace: второй педагог забирает группу 1 — у первого снята ровно она, событие unbound по нему
    const r8 = await subjects.saveCompetence(
      { teacherId: second.userId, subjectIds: [], positions: [{ subjectId: grpSubj.id, groupNos: [1, 2] }], replace: true },
      school.moderator,
    );
    const g8 = await rowsOf();
    check(
      r8.ok && g8.length === 1 && g8[0].teacherId === second.userId && g8[0].scope === 'group' && g8[0].groupNos.join() === '1,2',
      'компетенции: replace снял чужую группу 1 и собрал у педагога одну привязку к группам 1, 2',
    );
    const unb8 = await TenantContext.runAsSystem(() =>
      prisma.outboxEvent.findFirst({
        where: { type: 'subject.teacher.unbound.v1', workspaceId: school.workspaceId },
        orderBy: { createdAt: 'desc' },
      }),
    );
    check(((unb8?.payload ?? {}) as { teacherId?: string; subjectId?: string }).subjectId === grpSubj.id,
      'компетенции: замена группы издала teacher.unbound.v1 по карточке');

    // 12д. обратная Д6: групповая позиция поверх чужой классовой — конфликт; replace снимает классовую
    const clsSubj = await subjects.create({ name: 'Информатика', classId: grpCls.id });
    await subjects.bindTeacherManual(clsSubj.id, { teacherId: teacher.userId, scope: 'class' }, school.moderator);
    // список позиций — ПОЛНОЕ желаемое состояние педагога: свои группы 1, 2 английского остаются в списке
    const keepEng = { subjectId: grpSubj.id, groupNos: [1, 2] };
    const r9 = await subjects.saveCompetence(
      { teacherId: second.userId, subjectIds: [], positions: [keepEng, { subjectId: clsSubj.id, groupNos: [1] }] },
      school.moderator,
    );
    check(!r9.ok && r9.conflicts?.[0]?.groupNo === 1 && (r9.conflicts?.[0]?.teacherNames ?? []).includes('Петрова Анна'),
      'компетенции: группа поверх чужой классовой — конфликт с groupNo (Д6), мутаций нет');
    const r10 = await subjects.saveCompetence(
      { teacherId: second.userId, subjectIds: [], positions: [keepEng, { subjectId: clsSubj.id, groupNos: [1] }], replace: true },
      school.moderator,
    );
    const g10 = await prisma.teacherBinding.findMany({ where: { subjectId: clsSubj.id } });
    check(r10.ok && g10.length === 1 && g10[0].teacherId === second.userId && g10[0].scope === 'group' && g10[0].groupNos.join() === '1',
      'компетенции: replace снял чужую классовую привязку, педагог ведёт группу 1 — Д6 не нарушена');
    check((await rowsOf()).length === 1, 'компетенции: позиция английского из списка не тронута');

    // 12е. группы вне числа групп класса отклоняются; пустой список позиций открепляет всё
    let outside = false;
    await subjects
      .saveCompetence({ teacherId: second.userId, subjectIds: [], positions: [keepEng, { subjectId: clsSubj.id, groupNos: [3] }] }, school.moderator)
      .catch(() => { outside = true; });
    check(outside, 'компетенции: группа 3 в классе из двух групп отклонена');
    const r11 = await subjects.saveCompetence({ teacherId: second.userId, subjectIds: [], positions: [] }, school.moderator);
    check(r11.ok && r11.unbound === 2 && (await prisma.teacherBinding.count({ where: { teacherId: second.userId } })) === 0,
      'компетенции: пустой список позиций открепил обе групповые позиции педагога');

    // 12ж. СВОЯ привязка меняет вид без конфликта: класс → группа и группа → класс (конфликт — только по чужим);
    //      `positions` и `subjectIds` в одном запросе — читаются позиции
    const r12 = await subjects.saveCompetence({ teacherId: teacher.userId, subjectIds: [clsSubj.id] }, school.moderator);
    const r13 = await subjects.saveCompetence(
      { teacherId: teacher.userId, subjectIds: [clsSubj.id], positions: [{ subjectId: clsSubj.id, groupNos: [2] }] },
      school.moderator,
    );
    const g13 = await prisma.teacherBinding.findMany({ where: { subjectId: clsSubj.id } });
    check(r12.ok && r13.ok && r13.bound === 1 && r13.unbound === 1 && g13.length === 1 && g13[0].scope === 'group' && g13[0].groupNos.join() === '2',
      'компетенции: своя классовая привязка заменена групповой без конфликта — одна привязка к группе 2');
    const r14 = await subjects.saveCompetence(
      { teacherId: teacher.userId, subjectIds: [clsSubj.id], positions: [{ subjectId: clsSubj.id }] },
      school.moderator,
    );
    const g14 = await prisma.teacherBinding.findMany({ where: { subjectId: clsSubj.id } });
    check(r14.ok && r14.bound === 1 && r14.unbound === 1 && g14.length === 1 && g14[0].scope === 'class' && g14[0].teacherId === teacher.userId,
      'компетенции: своя групповая заменена классовой без конфликта (позиция без groupNos = весь класс)');

    // ---------- 13. число групп класса — `PUT /classes/:id/groups` (AR-202, §11 строка 50) ----------
    // Сценарий обёрнут: сбой внутри (например, событие вне канона AR-23 у эмиттера)
    // обязан лечь красной строкой отчёта, а не оборвать прогон без счётчиков.
    try {
    const c7 = await prisma.schoolClass.create({
      data: { workspaceId: school.workspaceId, parallel: 7, letter: 'Б', label: '7Б', groupCount: 0 },
    });
    const fio = [['Абалкин', 'Юрий'], ['Егоров', 'Пётр'], ['Ёлкина', 'Анна'], ['Яшин', 'Олег']];
    for (let i = 0; i < fio.length; i += 1) {
      await prisma.schoolStudent.create({
        data: { workspaceId: school.workspaceId, classId: c7.id, seq: i + 1, lastName: fio[i][0], firstName: fio[i][1], sex: i < 2 ? 'm' : 'f' },
      });
    }
    const v0 = (await state.register()).contingentVersion;
    await refuses(() => contingent.setGroups(c7.id, { groupCount: 2, version: v0 - 1 }, school.moderator), 'CONCURRENT_EDIT',
      'группы: чужая версия контингента — CONCURRENT_EDIT');
    let five = false;
    await contingent.setGroups(c7.id, { groupCount: 5, version: v0 }, school.moderator).catch(() => { five = true; });
    check(five && (await prisma.studentGroup.count({ where: { classId: c7.id } })) === 0, 'группы: пять групп отклонено, ничего не создано');

    const dto2 = await contingent.setGroups(c7.id, { groupCount: 2, version: v0 }, school.moderator);
    const g2 = await prisma.studentGroup.findMany({ where: { classId: c7.id }, include: { members: true }, orderBy: { groupNo: 'asc' } });
    check(dto2.groupCount === 2 && g2.length === 2 && g2.every((g) => g.members.length === 2),
      '0→2: ответ — ClassDto с groupCount 2; две группы, ученики разведены дефолтным разбиением по два (AR-75)');
    check(g2[0].members.map((m) => m.lastName).sort().join() === 'Абалкин,Егоров',
      '0→2: разбиение по алфавиту («ё» = «е») — Абалкин и Егоров в группе 1');
    const v1 = (await state.register()).contingentVersion;
    check(v1 === v0 + 1, 'группы: версия контингента поднята');
    const grpEvt = await TenantContext.runAsSystem(() =>
      prisma.outboxEvent.findFirst({
        where: { type: SCHOOL_EVENTS.classGroupsChanged, workspaceId: school.workspaceId },
        orderBy: { createdAt: 'desc' },
      }),
    );
    const gp = (grpEvt?.payload ?? {}) as { classId?: string; groupCount?: number };
    check(gp.classId === c7.id && gp.groupCount === 2, 'событие contingent.class.regrouped.v1 в outbox с classId и groupCount');

    const dto3 = await contingent.setGroups(c7.id, { groupCount: 3, version: v1 }, school.moderator);
    const g3 = await prisma.studentGroup.findMany({ where: { classId: c7.id }, include: { members: true }, orderBy: { groupNo: 'asc' } });
    check(dto3.groupCount === 3 && g3.length === 3 && g3[2].members.length === 0 && g3[0].members.length === 2 && g3[1].members.length === 2,
      '2→3: третья группа добавлена пустой, состав первых двух не пересчитан');

    // снимаемую группу ведёт педагог — GROUPS_BOUND с классом и номерами
    const s7 = await subjects.create({ name: 'Информатика', classId: c7.id });
    await subjects.bindTeacherManual(s7.id, { teacherId: teacher.userId, scope: 'group', groupNos: [3] }, school.moderator);
    const v2 = (await state.register()).contingentVersion;
    let gbDetails: { classLabel?: string; groups?: string } | undefined;
    await refuses(async () => {
      try {
        await contingent.setGroups(c7.id, { groupCount: 2, version: v2 }, school.moderator);
      } catch (e) {
        gbDetails = (e as { response?: { details?: typeof gbDetails } }).response?.details;
        throw e;
      }
    }, 'GROUPS_BOUND', '3→2 при педагоге на группе 3 — GROUPS_BOUND');
    check(gbDetails?.classLabel === '7Б' && gbDetails?.groups === '3', 'GROUPS_BOUND несёт класс и номера групп: «7Б», «3»');
    check((await prisma.studentGroup.count({ where: { classId: c7.id } })) === 3, 'после отказа все три группы целы');

    await subjects.unbind(s7.id, teacher.userId, school.moderator);
    const dto0 = await contingent.setGroups(c7.id, { groupCount: 0, version: v2 }, school.moderator);
    const pupils = await prisma.schoolStudent.findMany({ where: { classId: c7.id } });
    check(dto0.groupCount === 0 && (await prisma.studentGroup.count({ where: { classId: c7.id } })) === 0 && pupils.every((s) => s.groupId === null),
      '3→0 после открепления: группы сняты, ученики без группы');
    } catch (e) {
      bad(`группы (шаг 13): сценарий прерван — ${(e as Error).message}`);
    }
  });

  return report('G-78 · РУЧНАЯ ПРИВЯЗКА И КОМПЕТЕНЦИИ ПЕДАГОГА');
}

void main();
