/**
 * G-47 (AR-104, AR-99) — **стык спеки с ФИЗИЧЕСКОЙ схемой доказан перечислением.**
 *
 * Спека 1.1.1 описывает 11 доменных таблиц так, будто база пуста. База не пуста:
 * `schema.prisma` несёт контур КТП/КПП, и три доменных имени в нём заняты.
 * Проверка перечисляет: у каждой доменной таблицы версии есть модель с ключом
 * тенанта; три коллизии разведены префиксом `School*`; legacy не переименован и
 * не удалён; у «переиспользуемых» таблиц контура доступа появились недостающие
 * поля; и в миграции версии НЕТ НИ ОДНОГО `ALTER TABLE` по таблицам КТП/КПП.
 *
 * Запуск: npm --workspace apps/api run schemafit:check
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { bad, check, ok, report } from './schoolium/harness';

const SCHEMA = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8');

const model = (name: string): string | null => {
  const m = SCHEMA.match(new RegExp(`\\nmodel ${name} \\{([\\s\\S]*?)\\n\\}`));
  return m ? m[1] : null;
};

// 11 доменных таблиц версии: имя в спеке → имя модели в схеме
const DOMAIN: [spec: string, physical: string][] = [
  ['SchoolClass', 'SchoolClass'],
  ['Student', 'SchoolStudent'],
  ['StudentGroup', 'StudentGroup'],
  ['Subject', 'SchoolSubject'],
  ['TeacherBinding', 'TeacherBinding'],
  ['Term', 'Term'],
  ['ScheduleTemplate', 'ScheduleTemplate'],
  ['TemplateSlot', 'TemplateSlot'],
  ['Lesson', 'SchoolLesson'],
  ['Mark', 'Mark'],
  ['LessonTopic', 'LessonTopic'],
];

// Три занятых имени и их legacy-владельцы (AR-104)
const COLLISIONS: [name: string, marker: string][] = [
  ['Student', 'displayName'],
  ['Subject', 'fgosDocUrl'],
  ['Lesson', 'LessonState'],
];

// Таблицы контура КТП/КПП, по которым миграция версии не должна трогать ничего
const KTP_TABLES = [
  'Student', 'Subject', 'Lesson', 'Class', 'SubGroup', 'TeachingAssignment',
  'Timetable', 'TimetableSlot', 'JournalCell', 'Teacher', 'Ktp', 'KtpTopic',
  'Kpp', 'KppLesson', 'LessonContent', 'KppMapping',
];

// Пять новых таблиц контура доступа (AR-99)
const ACCESS_NEW = ['AppSession', 'DeviceLinkToken', 'LoginCode', 'ActivationToken', 'BootstrapLink'];

console.log('G-47 · стык спеки с физической схемой (AR-104)\n');

// ─── 1. одиннадцать доменных таблиц существуют и ключуются тенантом ───
for (const [spec, physical] of DOMAIN) {
  const body = model(physical);
  if (!body) {
    bad(`доменная таблица «${spec}» → модель ${physical} отсутствует в schema.prisma`);
    continue;
  }
  check(/\bworkspaceId\s+String/.test(body), `${spec} → ${physical}: ключ тенанта workspaceId стоит (AR-2, AR-44)`);
}

// ─── 2. три занятых имени разведены, legacy не тронут ───
for (const [name, marker] of COLLISIONS) {
  const legacy = model(name);
  if (!legacy) {
    bad(`legacy-модель ${name} исчезла — контур КТП/КПП не должен переименовываться и удаляться`);
    continue;
  }
  check(legacy.includes(marker), `legacy ${name} на месте и не тронут (маркер «${marker}»)`);
  check(model(`School${name}`) !== null, `коллизия имени ${name} разведена моделью School${name} (AR-104)`);
}
check(
  /enum LessonState \{[\s\S]*?idle[\s\S]*?running[\s\S]*?done/.test(SCHEMA),
  'у legacy Lesson остался СВОЙ автомат idle → running → done — с materialized/detached он не слит',
);
check(
  (model('SchoolLesson') ?? '').includes('detachedAt'),
  'SchoolLesson несёт detachedAt: урок с отметками отвязывается, а не удаляется (AR-85)',
);

// ─── 3. «переиспользуемые» таблицы контура доступа получили недостающие поля ───
const user = model('User') ?? '';
check(/phone\s+String\?\s+@unique/.test(user), 'User.phone заведён и уникален на инсталляцию (AR-46, AR-47)');
check(/middleName\s+String\?/.test(user), 'User.middleName заведён (отчество «при наличии», S-03/S-13)');
check(/avatarUrl\s+String\?/.test(user), 'User.avatarUrl заведён');

const membership = model('Membership') ?? '';
check(/roles\s+String\[\]/.test(membership), 'Membership.roles — МАССИВ ролей вместо строки florusRole (AR-60)');
check(/userId\s+String\?/.test(membership), 'Membership.userId заведён параллельно florusUserId (expand → migrate → contract)');
check(/florusRole\s+String/.test(membership), 'florusRole не снят: сжатие — отдельный инкремент AR-58, а не эта версия');
check(/deactivatedAt\s+DateTime\?/.test(membership), 'Membership.deactivatedAt: деактивация закрывает доступ (AR-92)');

const workspace = model('Workspace') ?? '';
check(/orgId\s+String\b(?!\?)/.test(workspace), 'Workspace.orgId — обязательная связь: bootstrap создаёт не только школу (AR-93)');

// ─── 4. пять новых таблиц контура доступа ───
for (const t of ACCESS_NEW) check(model(t) !== null, `таблица контура доступа ${t} заведена (AR-99)`);
check(model('Session') !== null && (model('Session') ?? '').includes('florusSid'),
  'legacy Session не расширена и не переиспользована — она уходит вместе с OIDC-контуром');
check(
  !(model('AppSession') ?? '').includes('accessToken'),
  'AppSession не наследует OIDC-полей legacy Session: это другой контур, а не его продолжение',
);

// ─── 5. миграция версии не трогает контур КТП/КПП ───
const dir = join(__dirname, '../prisma/migrations');
const versionMigrations = readdirSync(dir).filter((d) => d.includes('schoolium_111'));
check(versionMigrations.length === 1, `миграция версии одна: ${versionMigrations.join(', ') || '—'}`);
for (const m of versionMigrations) {
  const sql = readFileSync(join(dir, m, 'migration.sql'), 'utf8');
  const alters = [...sql.matchAll(/ALTER TABLE "([A-Za-z]+)"/g)].map((x) => x[1]);
  const touched = [...new Set(alters.filter((t) => KTP_TABLES.includes(t)))];
  check(
    touched.length === 0,
    touched.length === 0
      ? `миграция ${m}: ни одного ALTER по таблицам контура КТП/КПП (проверено ${alters.length} ALTER-ов)`
      : `миграция ${m} трогает контур КТП/КПП: ${touched.join(', ')}`,
  );
  // expand: ALTER-ы допустимы только по таблицам контура доступа
  const allowed = new Set(['User', 'Membership']);
  const foreign = [...new Set(alters.filter((t) => !allowed.has(t) && !sql.includes(`CREATE TABLE "${t}"`)))];
  check(foreign.length === 0, foreign.length === 0
    ? 'ALTER-ы миграции — только по User и Membership (контур доступа, AR-104)'
    : `ALTER по посторонним таблицам: ${foreign.join(', ')}`);
  check(/UPDATE "Membership" SET "userId"/.test(sql), 'шаг migrate есть: backfill Membership.userId из florusUserId');
}

// ─── 6. эталон инвентаря в модели совпадает с реальностью ───
const statesSrc = readFileSync(join(__dirname, '../../../specs/school-onboarding/model/states.mjs'), 'utf8');
for (const [name] of COLLISIONS) {
  check(
    new RegExp(`table: '${name}',\\s+collides: true`).test(statesSrc),
    `эталон schemaFit объявляет коллизию имени ${name} — документ и схема сходятся`,
  );
}

report('G-47 · СТЫК С ФИЗИЧЕСКОЙ СХЕМОЙ ДОКАЗАН');
