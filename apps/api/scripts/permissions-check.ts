/**
 * G-90 (AR-214) — **тумблер разрешений действительно меняет разрешение.**
 *
 * Раздел «Разрешения» `S-62` — не витрина каталога: правка администратора школы
 * обязана дойти до гейта роутов и до `GET /v1/me`, пережить рестарт (boot-sync
 * пересевает канон и прунит лишнее) и не протечь в соседнюю школу. Каждое из
 * этих утверждений здесь доказывается перечислением на живой базе.
 *
 * Запуск: npm --workspace apps/api run permissions:check
 */
import 'reflect-metadata';
import {
  APP_SECTIONS,
  PERMISSION_LABELS,
  ROLE_PERMISSIONS,
  SCHOOL_PERMISSIONS,
  SCHOOL_ROLES,
} from '@edustore/shared';
import { syncAuthzCatalog } from '../src/common/authz/catalog';
import { SchoolPermissionsService } from '../src/common/authz/school-permissions.service';
import { AuthzService } from '../src/common/authz/authz.service';
import { PermissionsService } from '../src/schoolium/cabinets/permissions.service';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { SCHOOL_EVENTS } from '../src/schoolium/schoolium.contract';
import { bench, bootstrapSchool, check, inSchool, makeStaff, refuses, report } from './schoolium/harness';

async function main(): Promise<void> {
  const b = await bench();
  const perms = b.get(PermissionsService);
  const resolver = b.get(SchoolPermissionsService);
  const authz = b.get(AuthzService);
  const drain = () => TenantContext.runAsSystem(() => b.outbox.drain());

  console.log('G-90 · разрешения школы: тумблер меняет право (AR-214)\n');

  // ─── 1. словарь разделов полон и однозначен ───
  const owners = new Map<string, string[]>();
  for (const s of APP_SECTIONS) for (const c of s.permissions) owners.set(c, [...(owners.get(c) ?? []), s.key]);
  const orphans = SCHOOL_PERMISSIONS.filter((c) => !owners.has(c));
  const doubles = [...owners].filter(([, ss]) => ss.length > 1).map(([c]) => c);
  check(orphans.length === 0, orphans.length === 0
    ? `все ${SCHOOL_PERMISSIONS.length} прав версии разложены по разделам приложения`
    : `права без раздела: ${orphans.join(', ')}`);
  check(doubles.length === 0, doubles.length === 0
    ? 'ни одно право не принадлежит двум разделам сразу'
    : `права в двух разделах: ${doubles.join(', ')}`);
  const unnamed = SCHOOL_PERMISSIONS.filter((c) => !PERMISSION_LABELS[c]);
  check(unnamed.length === 0, unnamed.length === 0
    ? 'у каждого права есть подпись функции — матрица не показывает голых кодов'
    : `права без подписи: ${unnamed.join(', ')}`);

  // ─── 2. школа без отклонений = канон версии ───
  const A = await bootstrapSchool(b, 'Школа A');
  const B = await bootstrapSchool(b, 'Школа B');
  const teacherA = await makeStaff(b, A, ['teacher'], 'Иванова Мария');
  const teacher2A = await makeStaff(b, A, ['teacher'], 'Кузнецов Пётр');
  const teacherB = await makeStaff(b, B, ['teacher'], 'Сидорова Ольга');

  const m0 = await inSchool(A.workspaceId, () => perms.matrix());
  const canon = SCHOOL_ROLES.every(
    (r) => [...m0.grants[r]].sort().join() === [...ROLE_PERMISSIONS[r]].sort().join(),
  );
  check(canon, canon ? 'матрица школы без правок совпадает с пакетами версии' : 'матрица разошлась с каноном до единой правки');

  const before = await resolver.effectiveForUser(A.workspaceId, teacherA.userId, ['teacher']);
  check(before.includes('journal.mark.post'), 'педагог школы A по канону ставит отметки');

  // ─── 3. общие: снятие права роли доходит до резолва ───
  await inSchool(A.workspaceId, () =>
    perms.setRolePermission({ role: 'teacher', permission: 'journal.mark.post', allowed: false }, A.moderator),
  );
  const after = await resolver.effectiveForUser(A.workspaceId, teacherA.userId, ['teacher']);
  check(!after.includes('journal.mark.post'), 'тумблер снял право роли — резолв педагога его больше не содержит');
  const after2 = await resolver.effectiveForUser(A.workspaceId, teacher2A.userId, ['teacher']);
  check(!after2.includes('journal.mark.post'), 'общая правка действует на ВСЕХ носителей роли, а не на одного');
  check(after.includes('journal.read'), 'снятие одного права не задевает соседние');

  // ─── 4. изоляция школ (AR-99) ───
  const other = await resolver.effectiveForUser(B.workspaceId, teacherB.userId, ['teacher']);
  check(other.includes('journal.mark.post'), 'правка школы A не видна школе B');

  // ─── 5. рестарт не стирает правку: канон пересевается, отклонение живёт ───
  await TenantContext.runAsSystem(() => syncAuthzCatalog(b.prisma));
  const afterBoot = await resolver.effectiveForUser(A.workspaceId, teacherA.userId, ['teacher']);
  check(!afterBoot.includes('journal.mark.post'), 'boot-sync каталога не стёр школьное отклонение');
  const pkg = await authz.resolveForRoles(['teacher']);
  check(pkg.permissions.includes('journal.mark.post'), 'канон версии в каталоге остался нетронутым — правит школа, а не пакет');

  // ─── 6. возврат в канон удаляет строку, а не пишет дубль ───
  await inSchool(A.workspaceId, () =>
    perms.setRolePermission({ role: 'teacher', permission: 'journal.mark.post', allowed: true }, A.moderator),
  );
  const rows = await TenantContext.runAsSystem(() =>
    b.prisma.schoolPermissionOverride.count({
      where: { workspaceId: A.workspaceId, scope: 'role', subject: 'teacher', permission: 'journal.mark.post' },
    }),
  );
  check(rows === 0, rows === 0 ? 'возврат тумблера в канон удалил строку отклонения' : `после возврата осталось строк: ${rows}`);
  const restored = await resolver.effectiveForUser(A.workspaceId, teacherA.userId, ['teacher']);
  check(restored.includes('journal.mark.post'), 'право вернулось вместе с тумблером');

  // ─── 7. общие: выдача права СВЕРХ пакета ───
  await inSchool(A.workspaceId, () =>
    perms.setRolePermission({ role: 'teacher', permission: 'subject.write', allowed: true }, A.moderator),
  );
  const widened = await resolver.effectiveForUser(A.workspaceId, teacherA.userId, ['teacher']);
  check(widened.includes('subject.write'), 'тумблер выдал роли право сверх пакета версии');

  // ─── 8. индивидуальные: адресно, и только этому человеку ───
  await inSchool(A.workspaceId, () =>
    perms.setUserPermission(teacherA.userId, { permission: 'subject.write', allowed: false }, A.moderator),
  );
  const one = await resolver.effectiveForUser(A.workspaceId, teacherA.userId, ['teacher']);
  const two = await resolver.effectiveForUser(A.workspaceId, teacher2A.userId, ['teacher']);
  check(!one.includes('subject.write'), 'индивидуальное снятие сильнее общей выдачи роли');
  check(two.includes('subject.write'), 'второй носитель роли адресной правкой не задет');

  const view = await inSchool(A.workspaceId, () => perms.userPermissions(teacherA.userId));
  check(view.base.includes('subject.write') && !view.effective.includes('subject.write'),
    'экран различает «есть у роли» и «снято лично» — состояние читается, а не угадывается');

  // ─── 9. `allowed: null` возвращает человека к пакету ролей ───
  await inSchool(A.workspaceId, () =>
    perms.setUserPermission(teacherA.userId, { permission: 'subject.write', allowed: null }, A.moderator),
  );
  const back = await resolver.effectiveForUser(A.workspaceId, teacherA.userId, ['teacher']);
  check(back.includes('subject.write'), 'снятие личного отклонения вернуло человека к пакету ролей');

  // ─── 10. замок кабинета администратора ───
  await refuses(
    () => inSchool(A.workspaceId, () => perms.setRolePermission({ role: 'admin', permission: 'school.admin', allowed: false }, A.moderator)),
    'PERMISSION_LOCKED',
    'снять «Кабинет администратора» у роли администратора',
  );
  await refuses(
    () => inSchool(A.workspaceId, () => perms.setUserPermission(A.moderator.userId, { permission: 'school.admin', allowed: false }, A.moderator)),
    'PERMISSION_LOCKED',
    'снять кабинет администратора адресно у его носителя',
  );
  const admin = await resolver.effectiveForUser(A.workspaceId, A.moderator.userId, A.moderator.roles);
  check(admin.includes('school.admin'), 'после двух отказов кабинет администратора на месте');

  // ─── 11. чужой человек в адресе — отзыв доступа, а не «не найдено» ───
  await refuses(
    () => inSchool(A.workspaceId, () => perms.userPermissions(teacherB.userId)),
    'ACCESS_REVOKED',
    'читать разрешения человека из другой школы',
  );

  // ─── 12. коды вытесняемого контура матрица не трогает ───
  const catalog = await authz.resolveForRoles(A.moderator.roles);
  const full = await resolver.resolve(A.workspaceId, A.moderator.userId, A.moderator.roles, catalog.permissions);
  check(full.includes('structure.devices.manage') && full.includes('settings.parser.manage'),
    'права вытесняемого контура у администратора проходят из каталога как есть');

  // ─── 13. каждая правка — строка леджера с идентичностью (AR-88) ───
  await drain();
  const ledger = await TenantContext.runAsSystem(() =>
    b.prisma.auditLog.findMany({ where: { workspaceId: A.workspaceId, action: SCHOOL_EVENTS.permissionSet } }),
  );
  /* Пять — ровно столько правок ПРОШЛО: два отказа замка до записи не дошли,
     и леджер это показывает. Число здесь точное, а не «не меньше»: «хотя бы
     сколько-то строк» доказывало бы, что аудит пишется, но не то, что он
     пишется по одной строке на правку. */
  check(ledger.length === 5, `правки разрешений в леджере: ${ledger.length} (прошло ровно пять, два отказа замка записи не оставили)`);
  check(ledger.every((r) => r.actor === A.moderator.userId), 'каждая строка несёт идентичность администратора');
  const personal = ledger.filter((r) => r.subjectUserId === teacherA.userId);
  check(personal.length >= 2, `адресные правки названы субъектом: ${personal.length}`);

  await b.close();
  report('G-90 · разрешения школы (AR-214)');
}

void main();
