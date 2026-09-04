/**
 * Событийный контракт Schoolium 1.1.1 — двадцать два события версии, плюс три
 * события кабинета администратора 1.3.0 (AR-186, AR-188, AR-189), плюс семь
 * событий пакета 04.09 1.5.0 (AR-202, AR-203, AR-206, AR-207): тридцать два.
 *
 * Канон имени (AR-23): `<домен>.<агрегат>.<глаголПрош>.v<N>`; публикация — только
 * через transactional outbox (AR-5), доставка каждому подписчику — через inbox
 * (AR-24, централизованно в шине).
 *
 * У КАЖДОГО события назван издатель, подписчик и реакция (AR-108). «Нет подписчика
 * (только аудит)» — законное значение; пустая клетка — дефект, и его ловят ворота
 * G-50, сверяя этот реестр с таблицей контрактов `30-spec.md`.
 */

export const SCHOOL_EVENTS = {
  classCreated: 'contingent.class.created.v1',
  studentUpserted: 'contingent.student.upserted.v1',
  studentDeactivated: 'contingent.student.deactivated.v1',
  studentReactivated: 'contingent.student.reactivated.v1',
  studentDeleted: 'contingent.student.deleted.v1',
  classDeleted: 'contingent.class.deleted.v1',
  subjectDeleted: 'subject.card.deleted.v1',
  teacherUnbound: 'subject.teacher.unbound.v1',
  teacherBound: 'subject.teacher.bound.v1',
  staffRegistered: 'staff.member.registered.v1',
  staffDeactivated: 'staff.member.deactivated.v1',
  staffReactivated: 'staff.member.reactivated.v1',
  staffDeleted: 'staff.member.deleted.v1',
  sessionStarted: 'staff.session.started.v1',
  sessionRevoked: 'staff.session.revoked.v1',
  termSet: 'calendar.term.set.v1',
  templateConfirmed: 'schedule.template.confirmed.v1',
  lessonMaterialized: 'schedule.lesson.materialized.v1',
  lessonDetached: 'schedule.lesson.detached.v1',
  markPosted: 'journal.mark.posted.v1',
  markRemoved: 'journal.mark.removed.v1',
  topicSet: 'journal.topic.set.v1',
  // 1.3.0 — кабинет администратора: ссылка входа с карточки (AR-189), лимиты
  // сессий (AR-188), реестры сети и устройств (AR-186). Все три — «только
  // аудит»: администратор держит полные права, противовес им тот же, что у
  // модератора (AR-88) — след каждого действия с его идентичностью.
  loginLinkIssued: 'staff.login_link.issued.v1',
  policySet: 'school.policy.set.v1',
  registryChanged: 'school.registry.changed.v1',
  // 1.5.0 — пакет 04.09. Отмена урока и замена (AR-207): три события, которыми
  // журнал узнаёт о новом педагоге колонки, отмене и её отзыве; предпочтения
  // педагога (AR-206) и число групп класса (AR-202) роняют сетку в stale;
  // учётка и пароль с карточки (AR-203) — «только аудит».
  lessonCancelled: 'schedule.lesson.cancelled.v1',
  lessonReassigned: 'schedule.lesson.reassigned.v1',
  lessonRestored: 'schedule.lesson.restored.v1',
  preferenceSet: 'schedule.preference.set.v1',
  accountUpdated: 'staff.account.updated.v1',
  passwordSet: 'staff.password.set.v1',
  classGroupsChanged: 'contingent.class.regrouped.v1',
} as const;

export type SchoolEventType = (typeof SCHOOL_EVENTS)[keyof typeof SCHOOL_EVENTS];

// ─────────────────────────── payload-контракты ───────────────────────────

export interface ClassCreatedV1 {
  classId: string;
  parallel: number;
  /** null — «без литер»: явный отказ мастера, а не пропущенное поле (AR-77). */
  letter: string | null;
  /** 0 — «без групп». */
  groupCount: number;
}
export interface StudentUpsertedV1 {
  studentId: string;
  classId: string;
  groupNo: number | null;
  lastName: string;
  firstName: string;
  middleName: string | null;
  sex: 'm' | 'f' | null;
}
export interface StudentDeactivatedV1 { studentId: string; classId: string; reason: string }
export interface StudentReactivatedV1 { studentId: string; classId: string }
export interface StudentDeletedV1 { studentId: string; classId: string }
export interface ClassDeletedV1 { classId: string; studentsDeleted: number }
export interface SubjectDeletedV1 { subjectId: string; classId: string }
export interface TeacherBoundV1 {
  subjectId: string;
  classId: string;
  teacherId: string;
  scope: 'class' | 'group';
  groupNos: number[];
}
export interface TeacherUnboundV1 {
  subjectId: string;
  classId: string;
  teacherId: string;
  reason: 'manual' | 'staff_removed' | 'class_removed';
}
export interface StaffRegisteredV1 { userId: string; roles: string[]; registeredVia: 'moderator_qr' }
export interface StaffDeactivatedV1 { userId: string; unboundSubjects: string[] }
export interface StaffReactivatedV1 { userId: string }
export interface StaffDeletedV1 { userId: string; unboundSubjects: string[] }
export interface SessionStartedV1 {
  userId: string;
  /** Канал входа (AR-187): `login_link` — одноразовая ссылка с карточки (AR-189). */
  via: 'registration' | 'device_link' | 'login_code' | 'bootstrap_link' | 'login_link' | 'password';
  deviceHint: string;
  /** Вкладка браузера либо установленное приложение — заголовок `x-schoolium-client`. */
  clientKind: 'browser' | 'pwa';
}
export interface SessionRevokedV1 {
  userId: string;
  /** `incident` — инцидент-режим (AR-188), `limit` — лимит сессий роли, `admin` — адресный отзыв из `S-62`. */
  reason: 'deactivated' | 'deleted' | 'manual' | 'activation_revoked' | 'incident' | 'limit' | 'admin';
}
export interface TermSetV1 { termNo: number; dateFrom: string; dateTo: string }
export interface TemplateConfirmedV1 { templateId: string; seed: number; weekSlots: number }
export interface LessonMaterializedV1 {
  lessonId: string;
  date: string;
  slotNo: number;
  classId: string;
  groupNo: number | null;
  subjectId: string;
  teacherId: string;
}
export interface LessonDetachedV1 { lessonId: string; date: string; classId: string; reason: 'regenerated' }
export interface MarkPostedV1 { lessonId: string; studentId: string; mark: string; postedBy: string }
export interface MarkRemovedV1 { lessonId: string; studentId: string; removedBy: string }
export interface TopicSetV1 { lessonId: string; topic: string; setBy: string }
/** Ссылка входа с карточки сотрудника (AR-189; AR-204: срок и лимит открытий выбирает выпускающий). */
export interface LoginLinkIssuedV1 {
  userId: string;
  issuedBy: string;
  expiresAt: string;
  ttlHours: number;
  /** `null` — без лимита открытий. */
  maxUses: number | null;
}
/** Лимиты одновременных сессий (AR-188) и носителей ролей (AR-205): `null` — без лимита. */
export interface PolicySetV1 {
  sessionLimits: Record<string, number | null>;
  roleLimits: Record<string, number | null>;
}
/** Реестр Wi-Fi сетей и корпоративных устройств школы (AR-186). */
export interface RegistryChangedV1 {
  kind: 'network' | 'asset';
  op: 'created' | 'updated' | 'deleted';
  id: string;
  name: string;
}
// 1.5.0 — пакет 04.09
/** Урок отменён БЕЗ замены (AR-207): журнал ставит `cancelledAt`, отметка отклоняется `LESSON_CANCELLED`. */
export interface LessonCancelledV1 {
  lessonId: string;
  date: string;
  slotNo: number;
  classId: string;
  groupNo: number | null;
  subjectId: string;
  teacherId: string;
  reason: 'absence' | 'training' | 'official' | 'other';
}
/** Урок получил другого педагога (AR-207): автоподбор, ручная замена либо отзыв (`to` = исходный). */
export interface LessonReassignedV1 {
  lessonId: string;
  date: string;
  fromTeacherId: string;
  toTeacherId: string;
  reason: 'absence' | 'training' | 'official' | 'other' | 'withdrawn' | 'manual';
}
/** Отмена без замены отозвана (AR-207): пометка `cancelledAt` снимается. */
export interface LessonRestoredV1 { lessonId: string; date: string }
/** Педагог задал рабочие дни (AR-206): 0..5, пусто — любой день. */
export interface PreferenceSetV1 { teacherId: string; workDays: number[] }
/** Учётка сотрудника изменена с карточки (AR-203): какие поля. */
export interface AccountUpdatedV1 { userId: string; updatedBy: string; fields: string[] }
/** Пароль сотрудника задан с карточки (AR-203): `generated` — сгенерирован сервером. */
export interface PasswordSetV1 { userId: string; setBy: string; generated: boolean }
/** Число групп класса изменено (AR-202): сетка → stale. */
export interface ClassGroupsChangedV1 { classId: string; groupCount: number }

// ─────────────── реестр «издатель → подписчик → реакция» (AR-108) ───────────────

export interface EventContractRow {
  type: SchoolEventType;
  publisher: string;
  /** Пустой массив = «нет подписчика (только аудит)» — законное значение. */
  subscribers: string[];
  reaction: string;
}

/**
 * Тот же перечень, что в таблице контрактов `30-spec.md`, но исполняемый: ворота
 * G-50 сверяют его с документом в обе стороны и требуют непустую реакцию у каждой
 * строки. Событие без подписчика, которое обязано его иметь, — это молчаливая
 * связь, выведенная исполнителем из соседнего раздела.
 */
export const EVENT_CONTRACT: EventContractRow[] = [
  { type: SCHOOL_EVENTS.classCreated, publisher: 'contingent', subscribers: ['schedule'], reaction: 'сетка → stale (класс без уроков)' },
  { type: SCHOOL_EVENTS.studentUpserted, publisher: 'contingent', subscribers: ['journal'], reaction: 'строка появляется либо обновляется; колонки не трогаются' },
  { type: SCHOOL_EVENTS.studentDeactivated, publisher: 'contingent', subscribers: ['journal'], reaction: 'строка помечена, из новых колонок исключена (AR-78)' },
  { type: SCHOOL_EVENTS.studentReactivated, publisher: 'contingent', subscribers: ['journal'], reaction: 'пометка снята, ученик снова в новых колонках' },
  { type: SCHOOL_EVENTS.studentDeleted, publisher: 'contingent', subscribers: ['journal'], reaction: 'строка снимается — иначе удалённый остаётся строкой-призраком (AR-108)' },
  { type: SCHOOL_EVENTS.classDeleted, publisher: 'contingent', subscribers: ['journal', 'schedule', 'subjects'], reaction: 'журнал снимает строки класса; сетка → stale; карточки предметов класса удаляются с subject.card.deleted.v1' },
  { type: SCHOOL_EVENTS.subjectDeleted, publisher: 'subjects', subscribers: ['schedule'], reaction: 'сетка → stale' },
  { type: SCHOOL_EVENTS.teacherUnbound, publisher: 'subjects', subscribers: ['schedule'], reaction: 'покрытие падает до неполного, сетка → stale' },
  { type: SCHOOL_EVENTS.teacherBound, publisher: 'subjects', subscribers: ['schedule'], reaction: 'сетка → stale' },
  { type: SCHOOL_EVENTS.staffRegistered, publisher: 'staff', subscribers: [], reaction: 'нет подписчика (только аудит): кто активировал, с какой карточки, каким QR (AR-30)' },
  { type: SCHOOL_EVENTS.staffDeactivated, publisher: 'staff', subscribers: ['schedule', 'access'], reaction: 'сетка → stale; все сессии отозваны (AR-92)' },
  { type: SCHOOL_EVENTS.staffReactivated, publisher: 'staff', subscribers: [], reaction: 'нет подписчика (только аудит): сессии не воскресают — вход заново' },
  { type: SCHOOL_EVENTS.staffDeleted, publisher: 'staff', subscribers: ['schedule', 'access'], reaction: 'сетка → stale; все сессии отозваны' },
  { type: SCHOOL_EVENTS.sessionStarted, publisher: 'access', subscribers: [], reaction: 'нет подписчика (только аудит): запись с каналом входа' },
  { type: SCHOOL_EVENTS.sessionRevoked, publisher: 'access', subscribers: [], reaction: 'нет подписчика (только аудит): запись с причиной отзыва' },
  { type: SCHOOL_EVENTS.termSet, publisher: 'calendar', subscribers: ['schedule'], reaction: 'сетка → stale; горизонт материализации пересчитан' },
  { type: SCHOOL_EVENTS.templateConfirmed, publisher: 'schedule', subscribers: [], reaction: 'нет подписчика (только аудит): материализация запускается тем же триггером, не событием' },
  { type: SCHOOL_EVENTS.lessonMaterialized, publisher: 'schedule', subscribers: ['journal'], reaction: 'появляется колонка на дату урока' },
  { type: SCHOOL_EVENTS.lessonDetached, publisher: 'schedule', subscribers: ['journal'], reaction: 'колонка помечена «вне расписания», запись отклоняется LESSON_DETACHED' },
  { type: SCHOOL_EVENTS.markPosted, publisher: 'journal', subscribers: [], reaction: 'нет подписчика (только аудит): средний балл считается чтением' },
  { type: SCHOOL_EVENTS.markRemoved, publisher: 'journal', subscribers: [], reaction: 'нет подписчика (только аудит): снятие отметки именное (AR-88)' },
  { type: SCHOOL_EVENTS.topicSet, publisher: 'journal', subscribers: [], reaction: 'нет подписчика (только аудит): тема не влияет ни на что, кроме себя' },
  // 1.3.0 (AR-186…AR-189): три события кабинета администратора
  { type: SCHOOL_EVENTS.loginLinkIssued, publisher: 'access', subscribers: [], reaction: 'нет подписчика (только аудит): кто и кому выпустил одноразовую ссылку входа на 48 часов' },
  { type: SCHOOL_EVENTS.policySet, publisher: 'administration', subscribers: [], reaction: 'нет подписчика (только аудит): кто изменил лимиты сессий; лимит применяется при следующей выдаче сессии, живые не трогает' },
  { type: SCHOOL_EVENTS.registryChanged, publisher: 'administration', subscribers: [], reaction: 'нет подписчика (только аудит): изменение реестра Wi-Fi сетей и корпоративных устройств школы' },
  // 1.5.0 — пакет 04.09 (AR-202, AR-203, AR-206, AR-207): семь событий
  { type: SCHOOL_EVENTS.lessonCancelled, publisher: 'schedule', subscribers: ['journal'], reaction: 'колонка помечена отменённой (`cancelledAt`), отметка отклоняется `LESSON_CANCELLED`' },
  { type: SCHOOL_EVENTS.lessonReassigned, publisher: 'schedule', subscribers: ['journal'], reaction: 'колонка получает нового педагога — заместитель ставит отметки, исходный нет' },
  { type: SCHOOL_EVENTS.lessonRestored, publisher: 'schedule', subscribers: ['journal'], reaction: 'пометка отмены снята' },
  { type: SCHOOL_EVENTS.preferenceSet, publisher: 'schedule', subscribers: ['schedule'], reaction: 'подтверждённая сетка → stale (AR-206)' },
  { type: SCHOOL_EVENTS.accountUpdated, publisher: 'staff', subscribers: [], reaction: 'нет подписчика (только аудит): кто и какие поля учётки изменил с карточки (AR-203)' },
  { type: SCHOOL_EVENTS.passwordSet, publisher: 'staff', subscribers: [], reaction: 'нет подписчика (только аудит): кто задал пароль и был ли он сгенерирован; сам пароль в событии не едет (AR-156)' },
  { type: SCHOOL_EVENTS.classGroupsChanged, publisher: 'contingent', subscribers: ['schedule'], reaction: 'сетка → stale (число групп меняет укладку)' },
];

/**
 * Человекочитаемые подписи строк аудита для `S-60.audit` (AR-116): «дата ·
 * действие · объект». Аудит хранит конверт события, а не доменную нагрузку
 * (AR-30), поэтому имя объекта берётся оттуда, где аудит его действительно
 * держит: ФИО субъекта ПДн, если событие о человеке, иначе — тип объекта из
 * имени события. Полнота карты проверяется воротами G-41 перечислением по
 * `EVENT_CONTRACT`: событие без подписи роняет ворота, а не показывает
 * человеку `school.mark.posted.v1`.
 */
export const AUDIT_LABELS: Record<SchoolEventType, { action: string; object: string }> = {
  [SCHOOL_EVENTS.classCreated]: { action: 'создан класс', object: 'класс' },
  [SCHOOL_EVENTS.classDeleted]: { action: 'удалён класс', object: 'класс' },
  [SCHOOL_EVENTS.studentUpserted]: { action: 'заполнен профиль ученика', object: 'ученик' },
  [SCHOOL_EVENTS.studentDeactivated]: { action: 'ученик деактивирован', object: 'ученик' },
  [SCHOOL_EVENTS.studentReactivated]: { action: 'ученик восстановлен', object: 'ученик' },
  [SCHOOL_EVENTS.studentDeleted]: { action: 'удалён ученик', object: 'ученик' },
  [SCHOOL_EVENTS.subjectDeleted]: { action: 'удалена карточка предмета', object: 'предмет' },
  [SCHOOL_EVENTS.teacherBound]: { action: 'педагог привязан к предмету', object: 'сотрудник' },
  [SCHOOL_EVENTS.teacherUnbound]: { action: 'педагог откреплён от предмета', object: 'сотрудник' },
  [SCHOOL_EVENTS.staffRegistered]: { action: 'сотрудник активировал карточку', object: 'сотрудник' },
  [SCHOOL_EVENTS.staffDeactivated]: { action: 'сотрудник деактивирован', object: 'сотрудник' },
  [SCHOOL_EVENTS.staffReactivated]: { action: 'сотрудник восстановлен', object: 'сотрудник' },
  [SCHOOL_EVENTS.staffDeleted]: { action: 'удалён сотрудник', object: 'сотрудник' },
  [SCHOOL_EVENTS.sessionStarted]: { action: 'вход в систему', object: 'сессия' },
  [SCHOOL_EVENTS.sessionRevoked]: { action: 'сессия завершена', object: 'сессия' },
  [SCHOOL_EVENTS.termSet]: { action: 'заданы учебные периоды', object: 'календарь' },
  [SCHOOL_EVENTS.templateConfirmed]: { action: 'подтверждено расписание', object: 'расписание' },
  [SCHOOL_EVENTS.lessonMaterialized]: { action: 'урок поставлен в календарь', object: 'урок' },
  [SCHOOL_EVENTS.lessonDetached]: { action: 'урок выведен из расписания', object: 'урок' },
  [SCHOOL_EVENTS.markPosted]: { action: 'выставлена отметка', object: 'ученик' },
  [SCHOOL_EVENTS.markRemoved]: { action: 'снята отметка', object: 'ученик' },
  [SCHOOL_EVENTS.topicSet]: { action: 'записана тема урока', object: 'урок' },
  // 1.3.0: строки аудита кабинета администратора (`S-62.audit`)
  [SCHOOL_EVENTS.loginLinkIssued]: { action: 'выпущена ссылка входа', object: 'сотрудник' },
  [SCHOOL_EVENTS.policySet]: { action: 'изменены лимиты сессий и ролей', object: 'политика доступа' },
  [SCHOOL_EVENTS.registryChanged]: { action: 'изменён реестр сети и устройств', object: 'реестр' },
  // 1.5.0 — пакет 04.09
  [SCHOOL_EVENTS.lessonCancelled]: { action: 'урок отменён без замены', object: 'урок' },
  [SCHOOL_EVENTS.lessonReassigned]: { action: 'урок передан другому педагогу', object: 'урок' },
  [SCHOOL_EVENTS.lessonRestored]: { action: 'отмена урока отозвана', object: 'урок' },
  [SCHOOL_EVENTS.preferenceSet]: { action: 'педагог задал рабочие дни', object: 'сотрудник' },
  [SCHOOL_EVENTS.accountUpdated]: { action: 'изменена учётка сотрудника', object: 'сотрудник' },
  [SCHOOL_EVENTS.passwordSet]: { action: 'задан пароль сотрудника', object: 'сотрудник' },
  [SCHOOL_EVENTS.classGroupsChanged]: { action: 'изменено число групп класса', object: 'класс' },
};

/**
 * Правки, делающие подтверждённую сетку устаревшей (AR-85). Перечисление, а не
 * догадка исполнителя: численность класса на сетку не влияет, поэтому приём
 * ученика в середине четверти плашку «расписание устарело» не поднимает.
 */
export const STALE_ON_EVENTS: SchoolEventType[] = [
  SCHOOL_EVENTS.classCreated,
  SCHOOL_EVENTS.classDeleted,
  SCHOOL_EVENTS.subjectDeleted,
  SCHOOL_EVENTS.teacherBound,
  SCHOOL_EVENTS.teacherUnbound,
  SCHOOL_EVENTS.staffDeactivated,
  SCHOOL_EVENTS.staffDeleted,
  SCHOOL_EVENTS.termSet,
  // 1.5.0: рабочие дни педагога (AR-206) и число групп класса (AR-202) меняют укладку
  SCHOOL_EVENTS.preferenceSet,
  SCHOOL_EVENTS.classGroupsChanged,
];
