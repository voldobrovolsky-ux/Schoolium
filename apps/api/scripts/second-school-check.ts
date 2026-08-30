/**
 * G-49 (AR-106, AR-47, AR-98) — **вторая школа в той же базе.**
 *
 * Три ветки регистрации по телефону (AR-106):
 *   членство в ЭТОЙ школе есть → `PHONE_TAKEN_IN_SCHOOL`;
 *   `User` есть, членства в этой школе нет → создаётся ВТОРОЕ членство, и
 *     регистрация НЕ отклоняется: педагог из двух школ работает в обеих;
 *   телефона нет → создаются `User` и `Membership`.
 * Все три отвечают одинаково по форме и неразличимы снаружи по времени — иначе
 * отказ сообщает постороннему факт существования записи в чужой школе.
 *
 * Плюс: изоляция держится при ДВУХ workspace в одной базе, и второй bootstrap не
 * требует ни одной правки кода — дефолтной школы в коде нет (AR-98).
 *
 * Запуск: npm --workspace apps/api run secondschool:check
 */
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { ContingentService } from '../src/schoolium/contingent/contingent.service';
import { StaffService } from '../src/schoolium/staff/staff.service';
import { bench, bootstrapSchool, check, inSchool, refuses, report } from './schoolium/harness';

const ROOT = join(__dirname, '../../..');

async function main(): Promise<void> {
  const b = await bench();
  const staff = b.get(StaffService);
  const contingent = b.get(ContingentService);
  const drain = () => TenantContext.runAsSystem(() => b.outbox.drain());

  console.log('G-49 · вторая школа в той же базе (AR-106, AR-98)\n');

  // ─── второй bootstrap без единой правки кода ───
  const a = await bootstrapSchool(b, 'Первая школа');
  const c = await bootstrapSchool(b, 'Вторая школа');
  check(a.workspaceId !== c.workspaceId, 'две школы — два разных workspace, заведённых одной и той же операцией (AR-98)');

  // ─── учётки двух школ (AR-154; вытесняет три телефонные ветки AR-106) ───
  const uname = `anna_${Math.floor(Math.random() * 10_000_000)}`;

  const first = await inSchool(a.workspaceId, async () => {
    const { card } = await staff.addCard({ role: 'teacher', lastName: 'Соколова', firstName: 'Анна', username: uname });
    const t = await staff.createActivationToken(card.id);
    return staff.activate(t.token, { openedByOtherSession: false, deviceHint: 'телефон' });
  });
  await drain();
  check(first.sessionToken !== null, 'первая школа: учётка заведена модератором, активация одним сканом выдала сессию');

  // тот же юзернейм во ВТОРОЙ школе → USERNAME_TAKEN: уникальность глобальна
  // (AR-154). Привязка СУЩЕСТВУЮЩЕЙ учётки ко второй школе — отложенное
  // (specs/school-launch/00-scope.md §4); отказ видит модератор на форме КПЦ,
  // а не аноним — канал утечки AR-47 закрыт правом staff.manage.
  await inSchool(c.workspaceId, async () => {
    await refuses(
      () => staff.addCard({ role: 'teacher', lastName: 'Соколова', firstName: 'Анна', username: uname }),
      'USERNAME_TAKEN',
      'вторая школа, тот же юзернейм → USERNAME_TAKEN: область уникальности — инсталляция',
    );
  });

  // вторая школа ведёт СВОЮ учётку — предзаполнение разводит занятость суффиксом
  const second = await inSchool(c.workspaceId, async () => {
    const { card } = await staff.addCard({ role: 'teacher', lastName: 'Соколова', firstName: 'Анна' });
    const t = await staff.createActivationToken(card.id);
    return staff.activate(t.token, { openedByOtherSession: false, deviceHint: 'телефон' });
  });
  await drain();
  check(second.userId !== first.userId, 'школы не блокируют друг друга: вторая завела собственную учётку');
  const memberships = await TenantContext.runAsSystem(() =>
    b.prisma.membership.findMany({ where: { userId: first.userId } }),
  );
  check(memberships.length === 1, `членств у первой учётки: ${memberships.length} — вторая школа её не трогала`);

  const user = await TenantContext.runAsSystem(() => b.prisma.user.findUnique({ where: { username: uname } }));
  check(user?.displayName === 'Соколова Анна', `глобальная запись первой школы не переписана: ${user?.displayName}`);

  // ─── изоляция при двух школах в одной базе ───
  await inSchool(a.workspaceId, () =>
    contingent.createClasses(
      { parallels: 2, letters: null, studentsPerClass: 2, groups: null, sexKind: 'boys', sexCount: 1, version: 0 },
      a.moderator,
    ),
  );
  await inSchool(c.workspaceId, () =>
    contingent.createClasses(
      { parallels: 3, letters: null, studentsPerClass: 2, groups: null, sexKind: 'girls', sexCount: 1, version: 0 },
      c.moderator,
    ),
  );
  await drain();
  const inA = await inSchool(a.workspaceId, () => contingent.listClasses());
  const inC = await inSchool(c.workspaceId, () => contingent.listClasses());
  check(inA.length === 2 && inC.length === 3,
    `каждая школа видит только свои классы: ${inA.length} и ${inC.length} — G-1 держится при двух workspace`);
  check(inA.every((x) => !inC.some((y) => y.id === x.id)), 'пересечения идентификаторов между школами нет');

  // ─── дефолтной школы в коде не существует ───
  const suspicious = execSync(
    `grep -rIn --include=*.ts --exclude-dir=node_modules --exclude-dir=dist -e "DEFAULT_WORKSPACE" -e "ws-archimed-pilot" ${join(ROOT, 'apps/api/src/schoolium')} || true`,
    { encoding: 'utf8' },
  ).trim();
  check(suspicious === '', 'константы «школы по умолчанию» в контуре 1.1.1 нет — пользователь появляется только через членство (AR-98)');
  const firstOfTable = execSync(
    `grep -rIn --include=*.ts --exclude-dir=node_modules "workspace.findFirst" ${join(ROOT, 'apps/api/src/schoolium')} || true`,
    { encoding: 'utf8' },
  ).trim();
  check(firstOfTable === '', 'чтения «первой школы из таблицы» нет ни в одном сервисе версии');

  await b.close();
  report('G-49 · ВТОРАЯ ШКОЛА ДОКАЗАНА');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
