/**
 * G-89 (AR-212, AR-2) — **стирание профиля перечислением.**
 *
 * «Удалить профиль» обещает человеку, что его данных в системе не осталось.
 * Обещание такого рода нельзя доказать разглядыванием кода: человек живёт в
 * схеме ссылками ПО ЗНАЧЕНИЮ — строкой `userId` в два десятка таблиц, без
 * единого внешнего ключа, — и «мы вроде всё удалили» здесь ничего не стоит.
 * Поэтому ворота доказывают два утверждения сразу:
 *
 *   1. **статически** — каждая колонка схемы, несущая идентификатор человека,
 *      отнесена к одному из трёх списков ниже. Новая колонка, о которой никто
 *      не решил, стирается она или остаётся, роняет ворота: решение принимает
 *      человек, а не умолчание;
 *   2. **динамически** — после удаления профиля ни одной строки с его
 *      идентификатором не остаётся нигде, кроме поимённого списка записей
 *      ШКОЛЫ (отметки, уроки, колонки журнала, слоты шаблона, замены, аудит,
 *      события), а сами эти записи целы;
 *   3. **изоляция (AR-2)** — у человека с членством во второй школе удаление
 *      профиля в первой не трогает ни вторую школу, ни учётку.
 *
 * Запуск: npm --workspace apps/api run erase:check
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { TenantContext } from '../src/common/tenant/tenant-context';
import { JournalService } from '../src/schoolium/journal/journal.service';
import { StaffService } from '../src/schoolium/staff/staff.service';
import { SchoolSessionService } from '../src/common/auth/school-session.service';
import type { PrismaService } from '../src/common/prisma/prisma.service';
import { bench, check, ensurePastLesson, inSchool, readySchool, report } from './schoolium/harness';

/**
 * Колонка несёт идентификатор человека, если её имя — одно из принятых имён
 * ссылки на `User.id`. Правило именования, а не список таблиц: список таблиц
 * устаревает молча, правило именования ловит и таблицу, которой ещё нет.
 */
const identityColumns = (): string[] => {
  const out: string[] = [];
  for (const m of Prisma.dmmf.datamodel.models) {
    for (const f of m.fields) {
      if (f.kind !== 'scalar' || f.type !== 'String') continue;
      const named =
        /^(actor|userId|teacherId|authorId|ownerId|granteeId|curatorId)$/.test(f.name) ||
        /(UserId|TeacherId)$/.test(f.name) ||
        /^[a-z]+By$/.test(f.name) ||
        (m.name === 'Teacher' && f.name === 'id');
      if (named) out.push(`${m.name}.${f.name}`);
    }
  }
  return out.sort();
};

/** Стирается удалением профиля: это данные ЧЕЛОВЕКА. */
const ERASED: Record<string, string> = {
  'Membership.userId': 'членство в школе — само право быть в ней',
  'Membership.florusUserId': 'та же строка членства (legacy-колонка AR-58)',
  'Session.florusUserId': 'серверная сессия RP — при стирании учётки',
  'AppSession.userId': 'сессии школы',
  'LoginCode.userId': 'одноразовые коды входа',
  'BootstrapLink.userId': 'ссылки входа, выпущенные ЕМУ',
  'BootstrapLink.issuedBy': 'след «кто выпустил» в чужих ссылках — обнуляется, ссылка живёт',
  'DeviceLinkToken.approvedBy': 'подтверждения привязки устройств',
  'ActivationToken.scannedBy': 'токены его карточки удаляются целиком',
  'Device.boundByUserId': 'киоск остаётся школе, след человека обнуляется',
  'TeacherBinding.teacherId': 'привязки к предметам — сняты каскадом до стирания',
  'TeacherPreference.teacherId': 'рабочие дни педагога (AR-206)',
  'StaffCard.userId': 'карточка стирается вместе с профилем — должность освобождается',
  'Teacher.id': 'строка педагога контура КТП (каскад по FK от User)',
  'TeachingAssignment.teacherId': 'назначения того же контура — каскадом от Teacher',
  'TeacherNote.teacherId': 'заметки педагога — каскадом от Teacher',
  'Notification.teacherId': 'его уведомления — каскадом от Teacher',
};

/** Остаётся: это записи ШКОЛЫ либо журнал обработки, а не данные человека. */
const KEPT: Record<string, string> = {
  'Mark.postedBy': 'отметка — документ школы об ученике; автор историческая ссылка (AR-89)',
  'JournalCell.postedBy': 'то же в едином журнале контура КТП',
  'JournalColumn.teacherId': 'колонка журнала = проведённый урок школы',
  'SchoolLesson.teacherId': 'материализованный урок школы; сетка помечена stale',
  'TemplateSlot.teacherId': 'слот шаблона недели — расписание школы',
  'LessonSubstitution.originalTeacherId': 'запись о замене — событие расписания школы',
  'LessonSubstitution.substituteTeacherId': 'то же: кто заменял',
  'LessonSubstitution.requestedBy': 'то же: кто запросил замену',
  'Lesson.teacherId': 'урок контура КТП — запись школы',
  'AuditLog.actor': 'журнал обработки ПДн: стереть — уничтожить доказательство удаления (152-ФЗ, AR-30)',
  'AuditLog.subjectUserId': 'то же: чьи ПДн затронуты',
  'OutboxEvent.actor': 'журнал доменных событий — история, а не состояние',
  'Ktp.approvedBy': 'КТП утверждена школой; утвердивший — историческая ссылка',
  'Kpp.approvedBy': 'то же для КПП',
  'Timetable.approvedBy': 'то же для расписания контура КТП',
  'FgosHours.approvedBy': 'то же для норм часов',
  'Methodic.authorId': 'методический материал школы',
  'Course.authorId': 'курс школы',
  'CourseAssignment.teacherId': 'назначение курса — запись школы',
  'File.ownerId': 'файл документохранилища школы',
  'DocVersion.authorId': 'версия документа школы',
  'Material.uploadedBy': 'материал школы',
  'Message.authorId': 'сообщение канала — общая запись переписки',
  'LessonTopic.setBy': 'тема урока — запись журнала школы',
  'CourseAssignment.assignedBy': 'назначение курса выдала школа',
  'AssessmentPolicy.updatedBy': 'политика оценивания школы; правивший — исторический след',
  'OrgStandards.updatedBy': 'то же для норм организации',
  'TimingProfile.updatedBy': 'то же для профиля времени',
  'WorkspaceSettings.updatedBy': 'то же для настроек школы',
  'SchoolAccessPolicy.incidentBy': 'след инцидент-режима школы (AR-188) — часть аудита доступа',
};

/** Ссылка на ДРУГОГО человека либо на другую роль того же: пусто по построению. */
const OTHERS: Record<string, string> = {
  'SchoolStudent.userId': 'учётка ученика — не сотрудник; держит User от стирания (AR-151)',
  'GuardianCard.userId': 'учётка родителя — то же',
  'PilotInvite.userId': 'пилотный контур выведен из употребления (AR-65)',
  'ChannelParticipant.userId': 'участие в канале — контур Коммуниториа, в версии школы не пишется',
  'MessageReaction.userId': 'то же',
  'Ack.userId': 'то же',
  'Lens.ownerId': 'линзы документохранилища — в версии школы не пишутся',
  'Collection.ownerId': 'то же',
  'ShareGrant.granteeId': 'то же',
  'Consent.subjectUserId': 'согласия — контур миноров (G-13), у персонала строк нет',
  'Parenthood.parentUserId': 'ребро родительства контура КТП; текущий контур ведёт связи GuardianLink',
};

/**
 * Счётчик строк по имени модели и колонки: списки выше — данные, а не код.
 * `workspaceId` подставляется, когда у таблицы он есть: удаление профиля в
 * ПЕРВОЙ школе доказывается в её границах, иначе строки второй школы того же
 * человека читались бы как «не стёрлось» (AR-2).
 */
type Counter = { count: (a: { where: Record<string, string> }) => Promise<number> };
const hasWorkspace = (model: string): boolean =>
  Prisma.dmmf.datamodel.models.find((m) => m.name === model)?.fields.some((f) => f.name === 'workspaceId') ?? false;
const rowsOf =
  (prisma: PrismaService) =>
  (qualified: string, id: string, workspaceId?: string): Promise<number> => {
    const [model, column] = qualified.split('.');
    const client = prisma as unknown as Record<string, Counter>;
    const delegate = client[model.charAt(0).toLowerCase() + model.slice(1)];
    const where: Record<string, string> = { [column]: id };
    if (workspaceId && hasWorkspace(model)) where.workspaceId = workspaceId;
    return TenantContext.runAsSystem(() => delegate.count({ where }));
  };

async function main(): Promise<void> {
  const b = await bench();
  const rows = rowsOf(b.prisma);
  const staff = b.get(StaffService);
  const journal = b.get(JournalService);
  const sessions = b.get(SchoolSessionService);
  const drain = () => TenantContext.runAsSystem(() => b.outbox.drain());

  console.log('G-89 · стирание профиля перечислением (AR-212)\n');

  // ─── 1. статически: каждая колонка-идентификатор отнесена к списку ───
  const columns = identityColumns();
  check(columns.length >= 40, `колонок с идентификатором человека в схеме: ${columns.length}`);
  const unlisted = columns.filter((c) => !ERASED[c] && !KEPT[c] && !OTHERS[c]);
  check(
    unlisted.length === 0,
    unlisted.length === 0
      ? 'каждая колонка отнесена к списку: стирается · остаётся записью школы · про другого человека'
      : `колонки без решения (стирать или оставить?): ${unlisted.join(', ')}`,
  );
  const phantom = [...Object.keys(ERASED), ...Object.keys(KEPT), ...Object.keys(OTHERS)].filter((c) => !columns.includes(c));
  check(phantom.length === 0, phantom.length === 0
    ? 'в списках нет исчезнувших колонок — список не пережил свою схему'
    : `в списках колонки, которых в схеме нет: ${phantom.join(', ')}`);

  // ─── 2. школа с педагогом, у которого есть всё: история, вход, устройства ───
  const s = await readySchool(b, 'Школа стирания');
  await ensurePastLesson(b, s.workspaceId);
  const userId = s.teacher.userId;
  const cardId = s.teacher.cardId;

  await inSchool(s.workspaceId, async () => {
    const actor = { userId, roles: ['teacher' as const], name: 'Иванова Мария' };
    const view = await journal.read(s.classId, s.subjectId, null);
    const past = view.columns.find((c) => !c.future);
    if (past) {
      await journal.postMark(past.lessonId, s.studentIds[0], '5', actor);
      await drain();
    }
    await staff.issueLoginCode(cardId);
    await staff.issueLoginLink(cardId, s.moderator, 'http://localhost:5173', {});
    await staff.createActivationToken(cardId);
    await sessions.issue({ userId, workspaceId: s.workspaceId, roles: ['teacher'], deviceHint: 'телефон педагога', via: 'login_code' });
  });
  await TenantContext.runAsSystem(async () => {
    await b.prisma.teacherPreference.create({ data: { workspaceId: s.workspaceId, teacherId: userId, workDays: [1, 2, 3] } });
    await b.prisma.device.create({
      data: { workspaceId: s.workspaceId, name: 'Киоск у входа', deviceToken: `dev-${randomUUID()}`, boundByUserId: userId },
    });
  });

  const marksBefore = await TenantContext.runAsSystem(() => b.prisma.mark.count({ where: { postedBy: userId } }));
  const lessonsBefore = await TenantContext.runAsSystem(() => b.prisma.schoolLesson.count({ where: { teacherId: userId } }));
  check(marksBefore > 0 && lessonsBefore > 0, `у педагога есть история: отметок ${marksBefore}, уроков ${lessonsBefore}`);
  const liveBefore: string[] = [];
  for (const c of Object.keys(ERASED)) if ((await rows(c, userId)) > 0) liveBefore.push(c);
  check(liveBefore.length >= 6, `перед стиранием человек живёт в таблицах: ${liveBefore.join(', ')}`);

  // ─── 3. вторая школа того же человека: изоляция важнее полноты (AR-2) ───
  const second = await TenantContext.runAsSystem(async () => {
    const first = await b.prisma.workspace.findUnique({ where: { id: s.workspaceId } });
    const ws = await b.prisma.workspace.create({ data: { orgId: first!.orgId, name: 'Вторая школа стирания' } });
    await b.prisma.schoolState.create({ data: { workspaceId: ws.id } });
    return ws.id;
  });
  await TenantContext.runAsSystem(async () => {
    await b.prisma.membership.create({
      data: { florusUserId: userId, userId, workspaceId: second, florusRole: 'staff', roles: ['teacher'] },
    });
    await b.prisma.staffCard.create({
      data: { workspaceId: second, section: 3, plannedRoles: ['teacher'], userId, seq: 1 },
    });
  });

  // ─── 4. удаление профиля в первой школе ───
  await inSchool(s.workspaceId, () => staff.remove(cardId, s.moderator));
  await drain();

  // Учётка и её контур (Session, Teacher и связанное с ним) живы, пока человека
  // держит вторая школа, — они проверяются шагом 6; членство второй школы тоже.
  const ACCOUNT_WIDE = ['Session.florusUserId', 'Teacher.id', 'TeachingAssignment.teacherId', 'TeacherNote.teacherId',
    'Notification.teacherId', 'Membership.userId', 'Membership.florusUserId'];
  for (const [c, why] of Object.entries(ERASED)) {
    if (ACCOUNT_WIDE.includes(c)) continue;
    check((await rows(c, userId, s.workspaceId)) === 0, `стёрто в школе удаления: ${c} — ${why}`);
  }
  for (const c of ['Mark.postedBy', 'SchoolLesson.teacherId', 'JournalColumn.teacherId']) {
    check((await rows(c, userId)) > 0, `осталось записью школы: ${c} — ${KEPT[c]}`);
  }
  for (const [c, why] of Object.entries(OTHERS)) {
    check((await rows(c, userId)) === 0, `строк о другом человеке не появилось: ${c} — ${why}`);
  }
  const audit = await TenantContext.runAsSystem(() =>
    b.prisma.auditLog.count({ where: { subjectUserId: userId, action: 'staff.member.deleted.v1' } }),
  );
  check(audit > 0, 'строка аудита об удалении записана и НЕ стёрта — иначе доказательства удаления не осталось бы (152-ФЗ)');

  // ─── 5. вторая школа цела, учётка жива ───
  const rest = await TenantContext.runAsSystem(() => b.prisma.membership.findMany({ where: { userId } }));
  check(rest.length === 1 && rest[0].workspaceId === second,
    'во второй школе членство цело — удаление профиля не пересекает границу тенанта (AR-2)');
  check((await TenantContext.runAsSystem(() => b.prisma.user.count({ where: { id: userId } }))) === 1,
    'учётка жива, пока её держит вторая школа: ФИО и логин — её данные, а не первой');
  check((await TenantContext.runAsSystem(() => b.prisma.staffCard.count({ where: { workspaceId: s.workspaceId, userId } }))) === 0,
    'в первой школе карточки не осталось — ни заполненной, ни пустым слотом');

  // ─── 6. последняя школа: учётка стирается физически ───
  const lastCard = await TenantContext.runAsSystem(() => b.prisma.staffCard.findFirst({ where: { workspaceId: second, userId } }));
  await inSchool(second, () =>
    staff.remove(lastCard!.id, { userId: s.moderator.userId, workspaceId: second, roles: ['admin', 'moderator'], name: 'оператор' }),
  );
  await drain();
  check((await TenantContext.runAsSystem(() => b.prisma.user.count({ where: { id: userId } }))) === 0,
    'последнее членство ушло — учётка стёрта физически: ФИО, логин и хэш пароля (AR-212)');
  check((await TenantContext.runAsSystem(() => b.prisma.membership.count({ where: { userId } }))) === 0,
    'членств не осталось ни в одной школе');
  for (const c of ACCOUNT_WIDE) check((await rows(c, userId)) === 0, `стёрто вместе с учёткой: ${c} — ${ERASED[c]}`);
  check((await TenantContext.runAsSystem(() => b.prisma.mark.count({ where: { postedBy: userId } }))) === marksBefore,
    `отметки на месте до последней: ${marksBefore} — журнал школы удалением человека не редактируется`);

  await b.close();
  report('G-89 · СТИРАНИЕ ПРОФИЛЯ ДОКАЗАНО ПЕРЕЧИСЛЕНИЕМ');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
