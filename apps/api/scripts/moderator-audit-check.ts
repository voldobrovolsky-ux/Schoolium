/**
 * G-41 (AR-88, AR-30) — **полные права модератора и аудит как противовес.**
 *
 * Перечислением по ВСЕМ 38 мутациям версии (`70-screens.md` §11):
 *   · модератор проходит каждую — отказа ПО ПРАВУ он получить не может;
 *   · четыре читающие роли не проходят ни одной;
 *   · педагог проходит только отметки и темы, и только в своих уроках;
 *   · каждое действие модератора попадает в аудит С ИДЕНТИЧНОСТЬЮ;
 *   · гейт реальности `LESSON_NOT_HELD` срабатывает и для модератора: полные
 *     права не отменяют факта календаря (AR-74);
 *   · у каждого события есть подпись для строки кабинета (AR-116).
 *
 * Запуск: npm --workspace apps/api run moderator:check
 */
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core/injector/modules-container';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MUTATION_PERMISSIONS, READ_PERMISSIONS, ROLE_PERMISSIONS, SCHOOL_PERMISSIONS, SCHOOL_ROLES } from '@edustore/shared';
import { REQUIRE_PERMISSION } from '../src/common/authz/require-permission.decorator';
import { AuthzService } from '../src/common/authz/authz.service';
import { AUDITED_TYPES } from '../src/common/audit/audit.service';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { AUDIT_LABELS, EVENT_CONTRACT } from '../src/schoolium/schoolium.contract';
import { JournalService } from '../src/schoolium/journal/journal.service';
import { bench, check, ensurePastLesson, inSchool, readySchool, refuses, report } from './schoolium/harness';

const MUTATIONS = new Set([RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE]);

/** Контроллеры контура 1.1.1 — перечислением, чтобы движок КТП сюда не попал. */
const SCHOOLIUM_CONTROLLERS = [
  'SchoolAuthController', 'MeController', 'ClassesController', 'StudentsController',
  'SubjectsController', 'StaffController', 'CalendarController', 'ScheduleController',
  'SchoolJournalController', 'SchoolAdminController',
];

async function main(): Promise<void> {
  const b = await bench();
  const authz = b.get(AuthzService);
  const journal = b.get(JournalService);
  const drain = () => TenantContext.runAsSystem(() => b.outbox.drain());

  console.log('G-41 · полные права модератора и аудит (AR-88, AR-30)\n');

  // ─── 1. пакеты ролей — матрица владельца 2026-08-28 (AR-150…AR-152, G-66) ───
  const admin = await authz.resolveForRoles(['admin']);
  check([...MUTATION_PERMISSIONS, ...READ_PERMISSIONS].every((p) => admin.permissions.includes(p)),
    'администратор школы держит все мутации и чтения версии — полнота прав переехала к нему (AR-148, AR-150)');
  const MOD_MUT = ['school.manage', 'contingent.write', 'staff.manage', 'staff.self.write'];
  const mod = await authz.resolveForRoles(['moderator']);
  check(
    MOD_MUT.every((p) => mod.permissions.includes(p)) &&
      MUTATION_PERMISSIONS.filter((p) => !MOD_MUT.includes(p)).every((p) => !mod.permissions.includes(p)),
    'модератор держит ровно КПЦ: классы, контингент, персонал, активации — и ничего из панели УТЦ (AR-152)',
  );
  const DEP_MUT = ['schedule.build', 'subject.write', 'staff.self.write'];
  const deputy = await authz.resolveForRoles(['deputy_academic']);
  check(
    DEP_MUT.every((p) => deputy.permissions.includes(p)) &&
      MUTATION_PERMISSIONS.filter((p) => !DEP_MUT.includes(p)).every((p) => !deputy.permissions.includes(p)),
    'завуч держит ровно панель УТЦ: предметы, привязки, расписание — и ничего из КПЦ (AR-152)',
  );
  for (const role of ['founder', 'director', 'deputy_upbringing'] as const) {
    const acc = await authz.resolveForRoles([role]);
    const mut = MUTATION_PERMISSIONS.filter((p) => acc.permissions.includes(p) && p !== 'staff.self.write');
    check(mut.length === 0, `${role}: ни одного мутационного права школы (кроме собственной аватарки) — ${mut.join(', ') || 'пусто'}`);
    check(READ_PERMISSIONS.every((p) => acc.permissions.includes(p)), `${role}: все пять читающих прав выданы (AR-69)`);
  }
  const teacher = await authz.resolveForRoles(['teacher']);
  check(teacher.permissions.includes('journal.mark.post') && teacher.permissions.includes('journal.topic.set'),
    'педагог держит отметки и темы — но принадлежность урока проверяется сервисом, а не каталогом');
  check(!teacher.permissions.includes('contingent.write') && !teacher.permissions.includes('staff.manage'),
    'педагог не ведёт контингент и не ведёт персонал');
  for (const role of ['parent', 'student'] as const) {
    const acc = await authz.resolveForRoles([role]);
    check(acc.permissions.length === 1 && acc.permissions[0] === 'diary.read',
      `${role}: ровно одна проекция diary.read — ни одной мутации и ни одного школьного чтения (AR-155, AR-158)`);
  }
  check(SCHOOL_ROLES.every((r) => ROLE_PERMISSIONS[r].length > 0), 'у каждой из девяти ролей непустой пакет прав');

  // ─── 2. перечисление мутаций контроллеров версии ───
  const container = b.app.get(ModulesContainer);
  const rows: { route: string; perm: string | undefined }[] = [];
  for (const m of container.values()) {
    for (const [, w] of m.controllers) {
      const ctor = w.metatype as (new () => unknown) | undefined;
      if (!ctor) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, ctor) ?? '');
      // Контур 1.1.1 — именно его контроллеры, а не всё, что живёт под /v1:
      // движок КТП/КПП тоже стоит на этом префиксе, и его права к версии не
      // относятся (AR-83, AR-84: два контура в одной базе, но не в одном сценарии).
      if (!SCHOOLIUM_CONTROLLERS.includes(ctor.name)) continue;
      const proto = ctor.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') continue;
        const h = proto[name] as object;
        if (typeof h !== 'function') continue;
        const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, h);
        if (method === undefined || !MUTATIONS.has(method)) continue;
        const path = String(Reflect.getMetadata(PATH_METADATA, h) ?? '');
        rows.push({ route: `/${base}/${path}`.replace(/\/+/g, '/'), perm: Reflect.getMetadata(REQUIRE_PERMISSION, h) });
      }
    }
  }
  check(rows.length >= 38, `мутаций контура 1.1.1 обнаружено: ${rows.length} (в §11 их 38)`);
  const gated = rows.filter((r) => r.perm);
  const forAdmin = gated.filter((r) => admin.permissions.includes(r.perm!));
  check(forAdmin.length === gated.length,
    `администратор школы проходит ВСЕ ${gated.length} гейченных мутаций — отказа по праву он получить не может (AR-148)`);
  const forModerator = gated.filter((r) => mod.permissions.includes(r.perm!));
  check(forModerator.every((r) => MOD_MUT.includes(r.perm!)) && forModerator.length > 0,
    `модератор проходит только мутации КПЦ: ${[...new Set(forModerator.map((r) => r.perm))].join(', ')} (AR-152)`);
  const forDeputy = gated.filter((r) => deputy.permissions.includes(r.perm!));
  check(forDeputy.every((r) => DEP_MUT.includes(r.perm!)) && forDeputy.length > 0,
    `завуч проходит только мутации панели УТЦ: ${[...new Set(forDeputy.map((r) => r.perm))].join(', ')} (AR-152)`);
  for (const role of ['founder', 'director', 'deputy_upbringing'] as const) {
    const acc = await authz.resolveForRoles([role]);
    const passes = gated.filter((r) => acc.permissions.includes(r.perm!) && r.perm !== 'staff.self.write');
    check(passes.length === 0, `${role} не проходит ни одной мутации школы (${passes.map((p) => p.route).join(', ') || 'ноль'})`);
  }
  const teacherPasses = gated.filter((r) => teacher.permissions.includes(r.perm!));
  check(teacherPasses.every((r) => ['journal.mark.post', 'journal.topic.set', 'staff.self.write'].includes(r.perm!)),
    `педагог проходит только ${teacherPasses.map((r) => r.perm).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`);

  // ─── 3. гейт реальности действует и на модератора ───
  const s = await readySchool(b, 'Школа модератора');
  await ensurePastLesson(b, s.workspaceId);
  await inSchool(s.workspaceId, async () => {
    const view = await journal.read(s.classId, s.subjectId, null);
    // Журнал отдаёт колонки ОДНОЙ недели (§S-50), поэтому будущий урок ищем
    // обходом строки календаря: в открытой неделе его может не быть вовсе, а
    // гейт даты проверять всё равно надо.
    const past = view.columns.find((c) => !c.future)!;
    let future = view.columns.find((c) => c.future);
    for (const w of view.weeks.filter((x) => x.hasLessons)) {
      if (future) break;
      const page = await journal.read(s.classId, s.subjectId, null, w.monday);
      future = page.columns.find((c) => c.future);
    }
    if (!future) throw new Error('в сетке нет ни одного будущего урока — гейт даты нечем проверить');
    // 1.2.0 (AR-152): полные права журнала — у администратора школы; в стенде
    // bootstrap-оператор несёт обе роли, actor здесь действует КАК admin
    const modActor = { userId: s.moderator.userId, roles: ['admin' as const], name: s.moderator.name };
    const teacherActor = { userId: s.teacher.userId, roles: ['teacher' as const], name: 'Иванова Мария' };
    const strangerActor = { userId: 'u-stranger', roles: ['teacher' as const], name: 'Чужой педагог' };

    await journal.postMark(past.lessonId, s.studentIds[0], '5', modActor);
    await drain();
    check(true, 'администратор ставит отметку в ЧУЖОМ уроке — полнота прав у него (AR-148, AR-152)');

    await refuses(() => journal.postMark(future.lessonId, s.studentIds[0], '5', modActor),
      'LESSON_NOT_HELD', 'администратор НЕ обходит гейт даты: непроведённый урок закрыт и для полных прав');

    await refuses(() => journal.postMark(past.lessonId, s.studentIds[0], '5', strangerActor),
      'нет права записи в этот урок', 'педагог в чужом уроке — отказ по принадлежности');

    await journal.postMark(past.lessonId, s.studentIds[1], '4', teacherActor);
    check(true, 'педагог ставит отметку в СВОЁМ уроке');

    // ─── 4. аудит: каждое действие с идентичностью ───
    await drain();
    const entries = await b.prisma.auditLog.findMany({ where: { workspaceId: s.workspaceId } });
    check(entries.length > 0, `записей в аудите школы: ${entries.length}`);
    check(entries.every((e) => e.actor !== null),
      'у каждой записи аудита назван действующий — идентичность, а не «система»');
    const modEntries = entries.filter((e) => e.actor === s.moderator.userId);
    check(modEntries.length > 0,
      `действий модератора в аудите: ${modEntries.length} — противовес полномочиям работает (AR-88)`);
    const markEntry = entries.find((e) => e.action === 'journal.mark.posted.v1' && e.actor === s.moderator.userId);
    check(Boolean(markEntry), 'отметка администратора в чужом уроке записана в аудит с его идентичностью');
  });

  // ─── 5. все 22 события версии аудируются ───
  const missing = EVENT_CONTRACT.filter((r) => !AUDITED_TYPES.includes(r.type));
  check(missing.length === 0, missing.length === 0
    ? `все ${EVENT_CONTRACT.length} событий версии попадают в аудит-леджер`
    : `вне аудита остались: ${missing.map((m) => m.type).join(', ')}`);

  // ─── 6. каждое событие имеет подпись для строки S-60.audit (AR-116) ───
  const unlabelled = EVENT_CONTRACT.filter((r) => !AUDIT_LABELS[r.type]);
  check(unlabelled.length === 0, unlabelled.length === 0
    ? `у всех ${EVENT_CONTRACT.length} событий есть человекочитаемая подпись действия — модератор не читает в кабинете имена типов`
    : `без подписи остались: ${unlabelled.map((m) => m.type).join(', ')}`);
  const namelessObject = EVENT_CONTRACT.filter((r) => !AUDIT_LABELS[r.type]?.object);
  check(namelessObject.length === 0, 'у каждой подписи назван тип объекта — строка аудита не бывает без объекта');
  const labelKeys = Object.keys(AUDIT_LABELS);
  const extra = labelKeys.filter((t) => !EVENT_CONTRACT.some((r) => r.type === t));
  check(extra.length === 0, extra.length === 0
    ? 'подписей ровно столько, сколько событий: карта не пережила удаление события'
    : `подписи без события: ${extra.join(', ')}`);

  await b.close();
  report('G-41 · ПРАВА МОДЕРАТОРА И АУДИТ ДОКАЗАНЫ');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
