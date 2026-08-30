/**
 * Событийный контракт Schoolium 1.1.1 — двадцать два события версии.
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
  via: 'registration' | 'device_link' | 'login_code' | 'bootstrap_link' | 'password';
  deviceHint: string;
}
export interface SessionRevokedV1 { userId: string; reason: 'deactivated' | 'deleted' | 'manual' | 'activation_revoked' }
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
];
