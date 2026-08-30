import { PrismaClient } from '@prisma/client';
// AR-36: роли и их права — из общего контракта, а не второй копией в бэке.
import { ROLE_LABELS, ROLE_PERMISSIONS, SCHOOL_ROLES, type SchoolRole } from '@edustore/shared';

/**
 * Канонический каталог прав (§5.1) — Раздел→Экран→Действие + пакеты ролей.
 * Это ОПРЕДЕЛЕНИЕ (версионируется в коде); рантайм-источник истины — БД, куда оно
 * идемпотентно засевается `syncAuthzCatalog`. Резолв доступа (AuthzService) читает из БД.
 * Расширение прав = строка здесь, не правка кода резолва.
 */
export interface PermissionDef {
  code: string;
  section: string;
  screen: string;
  action: string;
  label: string;
}
export interface RolePackageDef {
  key: string; // = роль/суб-роль EduStore (owner|admin|teacher|parent|student|zavuch|methodist|psychologist)
  cabinet: string; // CabinetKey фронта
  label: string;
  permissions: string[]; // коды Permission
}

export const PERMISSIONS: PermissionDef[] = [
  // учредитель
  { code: 'owner.metrics.view', section: 'owner', screen: 'metrics', action: 'view', label: 'Бизнес-метрики' },
  { code: 'owner.schools.view', section: 'owner', screen: 'schools', action: 'view', label: 'Школы' },
  { code: 'owner.license.view', section: 'owner', screen: 'license', action: 'view', label: 'Лицензия' },
  // структура школы (admin/завуч)
  { code: 'structure.disciplines.manage', section: 'structure', screen: 'disciplines', action: 'manage', label: 'Дисциплины' },
  { code: 'structure.distribution.manage', section: 'structure', screen: 'distribution', action: 'manage', label: 'Распределение учителей' },
  { code: 'structure.devices.manage', section: 'structure', screen: 'devices', action: 'manage', label: 'Устройства-киоски' },
  { code: 'structure.classes.manage', section: 'structure', screen: 'classes', action: 'manage', label: 'Классы и подгруппы' },
  { code: 'contingent.students.manage', section: 'contingent', screen: 'students', action: 'manage', label: 'Зачисление/учёт учеников' },
  { code: 'settings.parser.manage', section: 'settings', screen: 'parser', action: 'manage', label: 'Настройки парсера учебников' },
  // документохранилище (AR-35): manage = свои файлы/теги/версии; publish = статус-FSM/доступ/шаринг
  { code: 'doc.files.manage', section: 'doc', screen: 'files', action: 'manage', label: 'Файлы — загрузка/теги/версии' },
  { code: 'doc.files.publish', section: 'doc', screen: 'files', action: 'publish', label: 'Файлы — статус/доступ/шаринг' },
  // согласия 152-ФЗ (AR-29/AR-30): запись — любая аутентифицированная роль за себя/подопечного
  // (source-валидация в сервисе); заявка на удаление — родитель/админ/завуч
  { code: 'consent.record', section: 'consent', screen: 'consent', action: 'record', label: 'Фиксация согласия' },
  { code: 'consent.deletion.request', section: 'consent', screen: 'consent', action: 'deletion', label: 'Заявка на удаление ПДн' },
  // кабинет учителя
  { code: 'journal.grades.view', section: 'journal', screen: 'grades', action: 'view', label: 'Журнал — просмотр' },
  { code: 'journal.grades.edit', section: 'journal', screen: 'grades', action: 'edit', label: 'Журнал — оценки' },
  { code: 'planning.ktp.view', section: 'planning', screen: 'ktp', action: 'view', label: 'КТП — просмотр' },
  { code: 'planning.ktp.edit', section: 'planning', screen: 'ktp', action: 'edit', label: 'КТП — правка' },
  { code: 'planning.ktp.approve', section: 'planning', screen: 'ktp', action: 'approve', label: 'Утверждение КТП (завуч)' },
  { code: 'planning.kpp.approve', section: 'planning', screen: 'kpp', action: 'approve', label: 'Утверждение/генерация КПП (завуч)' },
  { code: 'lesson.conduct', section: 'lesson', screen: 'lesson', action: 'conduct', label: 'Проведение урока (учитель)' },
  // контракты завуча/методиста (Phase 1)
  { code: 'standards.assessment.manage', section: 'standards', screen: 'assessment', action: 'manage', label: 'Политика оценивания (завуч)' },
  { code: 'standards.org.manage', section: 'standards', screen: 'org', action: 'manage', label: 'Оргстандарты (завуч)' },
  { code: 'standards.fgos.approve', section: 'standards', screen: 'fgos', action: 'approve', label: 'Утверждение ФГОС-часов (завуч)' },
  { code: 'standards.timing.manage', section: 'standards', screen: 'timing', action: 'manage', label: 'Тайминг-профили (методист)' },
  // кабинеты (Phase 1)
  { code: 'methodics.manage', section: 'methodics', screen: 'library', action: 'manage', label: 'Методкопилка (методист)' },
  { code: 'courses.manage', section: 'courses', screen: 'studio', action: 'manage', label: 'Студия курсов (методист)' },
  { code: 'curation.assign', section: 'curation', screen: 'teachers', action: 'assign', label: 'Курирование/назначение (методист)' },
  { code: 'schedule.build', section: 'schedule', screen: 'builder', action: 'build', label: 'Сборка расписания (завуч)' },
  { code: 'materials.lesson.generate', section: 'materials', screen: 'lesson', action: 'generate', label: 'Генерация материалов' },
  { code: 'materials.textbook.upload', section: 'materials', screen: 'textbook', action: 'upload', label: 'Загрузка учебника (учитель)' },
  // Communitoria (каналы/объявления). admin/owner — tenancy-роли Флёра, в токен не приходят (§7.4),
  // поэтому «завуч/админ» на объявлениях = доменная роль завуча; админ действует через панель Флёра.
  { code: 'comm.channel.manage', section: 'comm', screen: 'channels', action: 'manage', label: 'Создание каналов Communitoria' },
  { code: 'comm.announcement.post', section: 'comm', screen: 'announcements', action: 'post', label: 'Публикация объявлений (завуч)' },
  { code: 'notes.teacher.edit', section: 'notes', screen: 'teacher', action: 'edit', label: 'Заметки учителя' },
  { code: 'schedule.view', section: 'schedule', screen: 'schedule', action: 'view', label: 'Расписание' },
  // методист
  { code: 'methodics.umk.view', section: 'methodics', screen: 'umk', action: 'view', label: 'УМК' },
  { code: 'methodics.rp.view', section: 'methodics', screen: 'rp', action: 'view', label: 'Рабочая программа' },
  // родитель / ученик
  { code: 'diary.child.view', section: 'diary', screen: 'child', action: 'view', label: 'Дневник ребёнка' },
  { code: 'grades.child.view', section: 'grades', screen: 'child', action: 'view', label: 'Оценки ребёнка' },
  { code: 'tasks.view', section: 'tasks', screen: 'tasks', action: 'view', label: 'Задания' },
  { code: 'progress.view', section: 'progress', screen: 'progress', action: 'view', label: 'Успеваемость' },
  // психолог (risk-карта — гейт согласия на профилирование, §6.3)
  { code: 'psych.cases.view', section: 'psych', screen: 'cases', action: 'view', label: 'Кейсы' },
  { code: 'psych.sessions.view', section: 'psych', screen: 'sessions', action: 'view', label: 'Сессии' },
  { code: 'psych.risk.view', section: 'psych', screen: 'risk', action: 'view', label: 'Risk-карта' },
  // ─── Schoolium 1.1.1 (AR-69, AR-88): тринадцать кодов версии ───
  // Восемь мутационных. `schedule.build` уже есть выше — код тот же, пакет другой.
  { code: 'school.manage', section: 'school', screen: 'admin', action: 'manage', label: 'Кабинет модератора школы' },
  { code: 'contingent.write', section: 'school', screen: 'classes', action: 'write', label: 'Ведение классов и контингента' },
  { code: 'subject.write', section: 'school', screen: 'subjects', action: 'write', label: 'Ведение предметов и привязок' },
  { code: 'staff.manage', section: 'school', screen: 'staff', action: 'manage', label: 'Ведение персонала' },
  { code: 'journal.mark.post', section: 'school', screen: 'journal', action: 'mark', label: 'Постановка и снятие отметок' },
  { code: 'journal.topic.set', section: 'school', screen: 'journal', action: 'topic', label: 'Тема урока' },
  { code: 'staff.self.write', section: 'school', screen: 'profile', action: 'write', label: 'Собственная аватарка' },
  // Пять читающих: выдаются всем шести ролям. Записи «*.read» в каталоге не
  // существует — это сокращение текста спеки, а не код (G-10 сверяет коды).
  // Проекция ученика и родителя (AR-158): дневник и средние по предметам.
  { code: 'diary.read', section: 'school', screen: 'diary', action: 'read', label: 'Дневник — просмотр' },
  { code: 'classes.read', section: 'school', screen: 'classes', action: 'read', label: 'Классы — просмотр' },
  { code: 'subjects.read', section: 'school', screen: 'subjects', action: 'read', label: 'Предметы — просмотр' },
  { code: 'staff.read', section: 'school', screen: 'staff', action: 'read', label: 'Персонал — просмотр' },
  { code: 'schedule.read', section: 'school', screen: 'schedule', action: 'read', label: 'Расписание — просмотр' },
  { code: 'journal.read', section: 'school', screen: 'journal', action: 'read', label: 'Журнал — просмотр' },
];

/**
 * Пакеты шести ролей Schoolium 1.1.1 (AR-60). Строятся из `ROLE_PERMISSIONS`
 * пакета `@edustore/shared` — того же источника, которым пользуется фронт:
 * расхождение каталога и интерфейса ломает `tsc`, а не обнаруживается в проде.
 *
 * Модератор держит ВСЕ ТРИНАДЦАТЬ (AR-88): любая мутация версии проходит для
 * него, включая отметку в чужом уроке. Противовес полномочиям один — полный
 * аудит его действий (ворота G-41).
 *
 * Ключ `teacher` совпадает с legacy-пакетом кабинета учителя: 1.1.1 не заводит
 * второго пакета под тем же именем, а ДОПОЛНЯЕТ существующий правами версии —
 * иначе один человек получил бы разный доступ в зависимости от того, какой
 * контур его обслуживает.
 */
const SCHOOLIUM_CABINET: Record<SchoolRole, string> = {
  moderator: 'moderator',
  teacher: 'teacher',
  founder: 'founder',
  director: 'director',
  deputy_academic: 'deputy_academic',
  deputy_upbringing: 'deputy_upbringing',
  // 1.2.0 (AR-150): администратор школы и проекции ученика/родителя
  admin: 'admin',
  parent: 'parent',
  student: 'student',
};

export const SCHOOLIUM_PACKAGES: RolePackageDef[] = SCHOOL_ROLES.filter((r) => r !== 'teacher').map((role) => ({
  key: role,
  cabinet: SCHOOLIUM_CABINET[role],
  label: ROLE_LABELS[role],
  permissions: [
    ...ROLE_PERMISSIONS[role],
    // «Серьёзная техническая настройка» админа (матрица владельца, AR-150):
    // устройства-киоски и настройки парсера переходят ему от снятого
    // legacy-пакета — роуты живут, владелец у них теперь школьный админ.
    ...(role === 'admin' ? ['structure.devices.manage', 'settings.parser.manage'] : []),
  ],
}));

// Каталог строится ТОЛЬКО на доменных ролях (teacher|student|parent|staff·завуч/методист/
// психолог). admin/owner — tenancy-роли Флёра (RoleAssignment), в токен не приходят (канон
// §7.4) → пакетов на них нет; их кабинеты ведёт панель Флёра/walk-up, не каталог RP.
export const ROLE_PACKAGES: RolePackageDef[] = [
  // Кабинет учителя: legacy-права контура КТП + права преподавателя 1.1.1 (AR-60).
  { key: 'teacher', cabinet: 'teacher', label: 'Кабинет учителя', permissions: ['journal.grades.view', 'journal.grades.edit', 'planning.ktp.view', 'planning.ktp.edit', 'materials.lesson.generate', 'materials.textbook.upload', 'comm.channel.manage', 'notes.teacher.edit', 'lesson.conduct', 'schedule.view', 'doc.files.manage', 'consent.record', ...ROLE_PERMISSIONS.teacher] },
  { key: 'zavuch', cabinet: 'zavuch', label: 'Кабинет завуча', permissions: ['structure.disciplines.manage', 'structure.distribution.manage', 'structure.classes.manage', 'contingent.students.manage', 'planning.ktp.view', 'planning.ktp.edit', 'planning.ktp.approve', 'planning.kpp.approve', 'standards.assessment.manage', 'standards.org.manage', 'standards.fgos.approve', 'comm.channel.manage', 'comm.announcement.post', 'schedule.build', 'schedule.view', 'doc.files.manage', 'doc.files.publish', 'consent.record', 'consent.deletion.request'] },
  { key: 'methodist', cabinet: 'methodist', label: 'Кабинет методиста', permissions: ['structure.disciplines.manage', 'methodics.umk.view', 'methodics.rp.view', 'standards.timing.manage', 'methodics.manage', 'courses.manage', 'curation.assign', 'comm.channel.manage', 'doc.files.manage', 'doc.files.publish', 'consent.record'] },
  { key: 'psychologist', cabinet: 'psychologist', label: 'Кабинет психолога', permissions: ['psych.cases.view', 'psych.sessions.view', 'psych.risk.view', 'consent.record'] },
  // 1.2.0 (AR-150): ключи `admin`, `parent`, `student` ПЕРЕХОДЯТ контуру
  // Schoolium — их legacy-пакеты (AdminApp, кабинеты родителя/ученика
  // вытесняемого контура) сняты этим же изменением: один ключ не может
  // обслуживать два контура (прецедент AR-83), а сессии с этими ролями в
  // рантайме 1.2.0 выдаёт только контур `sch_sid` (AR-94).
  // Schoolium 1.2.0: роли версии (teacher дополнен выше).
  ...SCHOOLIUM_PACKAGES,
];

/** Идемпотентно засеять каталог в БД из канонического определения (boot + сид). */
export async function syncAuthzCatalog(prisma: PrismaClient): Promise<void> {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { section: p.section, screen: p.screen, action: p.action, label: p.label },
      create: p,
    });
  }
  for (const pkg of ROLE_PACKAGES) {
    const row = await prisma.rolePackage.upsert({
      where: { key: pkg.key },
      update: { cabinet: pkg.cabinet, label: pkg.label },
      create: { key: pkg.key, cabinet: pkg.cabinet, label: pkg.label },
    });
    for (const code of pkg.permissions) {
      const perm = await prisma.permission.findUnique({ where: { code } });
      if (!perm) continue;
      await prisma.rolePackagePermission.upsert({
        where: { rolePackageId_permissionId: { rolePackageId: row.id, permissionId: perm.id } },
        update: {},
        create: { rolePackageId: row.id, permissionId: perm.id },
      });
    }
  }
  // прунинг: убрать пакеты, выпавшие из канона (например прежние admin/owner — tenancy-роли,
  // каталог на них не строим). Связи RolePackagePermission уходят каскадом.
  const keep = ROLE_PACKAGES.map((p) => p.key);
  await prisma.rolePackage.deleteMany({ where: { key: { notIn: keep } } });
}
