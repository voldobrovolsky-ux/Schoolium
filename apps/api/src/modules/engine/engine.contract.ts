/**
 * События движка планирования (Архстандарт §6 — мастер-каталог). Subjects — канон AR-23
 * `<домен>.<агрегат>.<глаголПрош>.v<N>`,
 * на kernel-outbox (DomainEvent-конверт). Имена существующих subject'ов не меняются — только новые.
 */
export const ENGINE_EVENTS = {
  ktpGenerated: 'planning.ktp.generated.v1',
  ktpApproved: 'planning.ktp.approved.v1',
  kppScheduled: 'planning.kpp.scheduled.v1',
  kppApproved: 'planning.kpp.approved.v1',
  scheduleBuilt: 'planning.schedule.built.v1',
  timetableUpdated: 'planning.timetable.updated.v1', // AR-38: завуч сохранил сетку (типовая неделя)
  lessonStarted: 'lesson.lesson.started.v1',
  lessonPhaseChanged: 'lesson.phase.changed.v1',
  // сигналы результата → ИОМ (Архстандарт §6). attendance/topic несут реальный studentId.
  attendanceMarked: 'lesson.attendance.marked.v1',
  topicProgressed: 'lesson.topic.progressed.v1', // нетерминальное
  topicCompleted: 'lesson.topic.completed.v1', // терминальное (mastery)
  // петля летучки. brieftest по присутствующим (КОДЫ); assessment.checked несёт studentCode (§3).
  brieftestGenerated: 'assessment.brieftest.generated.v1',
  assessmentChecked: 'assessment.result.checked.v1',
  // журнал — только grade.posted (реальный studentId); персонализация — ktp.shift.proposed (предложение)
  gradePosted: 'journal.grade.posted.v1',
  gradeRemoved: 'journal.grade.removed.v1', // снятие оценки (коррекция) — для аудита AR-30
  ktpShiftProposed: 'planning.ktp_shift.proposed.v1',
} as const;

export interface AttendanceMarkedV1 {
  lessonId: string;
  marks: { studentId: string; status: string; arrivalTime?: string }[];
}
export interface TopicProgressedV1 {
  lessonId: string;
  topicId: string;
  timeSpent: number;
}
export interface TopicCompletedV1 {
  lessonId: string;
  topicId: string;
}
export interface BrieftestGeneratedV1 {
  briefTestId: string;
  lessonId: string;
  count: number;
}
export interface AssessmentCheckedV1 {
  briefTestId: string;
  lessonId: string;
  results: { studentCode: string; score: number }[]; // КОДЫ (не studentId) — гейт §3
}
export interface GradePostedV1 {
  lessonId: string;
  studentId: string; // реальный (человеко-авторское)
  grade: string;
}
export interface KtpShiftProposedV1 {
  lessonId: string;
  action: string;
  reason?: string;
}

export interface KtpApprovedV1 {
  ktpId: string;
  classId: string;
  disciplineId: string;
}
/** Черновик КТП создан/дополнен генератором из разбора учебника (textbook.parsed). */
export interface KtpGeneratedV1 {
  ktpId: string;
  classId: string;
  disciplineId: string;
  materialId: string;
  topicsAdded: number;
  cardsAttached: number;
}
export interface KppScheduledV1 {
  kppId: string;
  classId: string;
  disciplineId: string;
  lessonCount: number;
}
export interface KppApprovedV1 {
  kppId: string;
}
export interface LessonStartedV1 {
  lessonId: string;
}
export interface LessonPhaseChangedV1 {
  lessonId: string;
  phase: string;
}
