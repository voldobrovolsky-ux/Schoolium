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
 *   7-12. компетенции (AR-179): галочка ставит класс-привязку; снятая галочка
 *   открепляет; занятая позиция без `replace` — конфликт с фамилиями и НИ
 *   ОДНОЙ мутации; с `replace` — замена (прежний откреплён, новый привязан) и
 *   события обеих операций; позиция с групповыми привязками не трогается.
 *
 * Запуск: npm --workspace apps/api run bindmanual:check
 */
import { SubjectsService } from '../src/schoolium/subjects/subjects.service';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { bench, bootstrapSchool, check, inSchool, makeStaff, report } from './schoolium/harness';

async function main(): Promise<never> {
  const b = await bench();
  const subjects = b.get(SubjectsService);
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

    // 12. позиция с групповыми привязками этим каналом не трогается (Д6)
    const grpCls = await prisma.schoolClass.create({
      data: { workspaceId: school.workspaceId, parallel: 6, letter: 'А', label: '6А', groupCount: 2 },
    });
    const grpSubj = await subjects.create({ name: 'Английский язык', classId: grpCls.id });
    await subjects.bindTeacherManual(grpSubj.id, { teacherId: teacher.userId, scope: 'group', groupNos: [1] }, school.moderator);
    const r5 = await subjects.saveCompetence({ teacherId: second.userId, subjectIds: [grpSubj.id] }, school.moderator);
    const grpRows = await prisma.teacherBinding.findMany({ where: { subjectId: grpSubj.id } });
    check(r5.ok && grpRows.length === 1 && grpRows[0].scope === 'group',
      'компетенции: позиция с групповыми привязками не тронута — группы из карточки предмета (Д6)');
  });

  return report('G-78 · РУЧНАЯ ПРИВЯЗКА И КОМПЕТЕНЦИИ ПЕДАГОГА');
}

void main();
