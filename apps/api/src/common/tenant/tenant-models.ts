/**
 * Доменные модели под изоляцией тенанта (§3.6, канон Флёра) → колонка ключа тенанта.
 * ЕДИНИЦА ИЗОЛЯЦИИ = школа = Workspace; ключ = workspaceId. Единый источник истины для
 * tenant-guard (и будущего RLS, ключуемого на workspaceId).
 *
 * НЕ перечисленные модели не фильтруются осознанно:
 *  - User / Membership / Session — directory & identity, доступ по florus_user_id
 *    (членства пользователя живут в РАЗНЫХ школах — фильтр по одной их бы скрыл);
 *  - Organization — ПЛАТФОРМА (одна, общая), не тенант; Worknet — tenancy-инфра (сеть);
 *  - OutboxEvent / ProcessedEvent — инфраструктура шины, читается системным воркером.
 * Workspace фильтруется по собственному `id` (видишь только свою школу).
 */
export const TENANT_COLUMN: Record<string, string> = {
  Workspace: 'id',
  Subject: 'workspaceId',
  Class: 'workspaceId',
  Lesson: 'workspaceId',
  Teacher: 'workspaceId',
  Device: 'workspaceId',
  ChannelMembership: 'workspaceId',
  MealOrder: 'workspaceId',
  Student: 'workspaceId',
  SubGroup: 'workspaceId',
  TeachingAssignment: 'workspaceId',
  GeneratedMaterial: 'workspaceId',
  StudentProfile: 'workspaceId',
  TeacherNote: 'workspaceId',
  Notification: 'workspaceId',
  Consent: 'workspaceId',
  AuditLog: 'workspaceId',
  Entitlement: 'workspaceId',
  // движок планирования (Phase 1)
  Ktp: 'workspaceId',
  KtpTopic: 'workspaceId',
  Timetable: 'workspaceId',
  TimetableSlot: 'workspaceId',
  Kpp: 'workspaceId',
  KppLesson: 'workspaceId',
  KppMapping: 'workspaceId',
  LessonContent: 'workspaceId',
  CompetencyNode: 'workspaceId',
  InterestNode: 'workspaceId',
  MasteryEdge: 'workspaceId',
  InterestEdge: 'workspaceId',
  BriefTest: 'workspaceId',
  BriefTestCode: 'workspaceId',
  AssessmentResult: 'workspaceId',
  AssessmentResultItem: 'workspaceId',
  JournalCell: 'workspaceId',
  AssessmentPolicy: 'workspaceId',
  TimingProfile: 'workspaceId',
  OrgStandards: 'workspaceId',
  WorkspaceSettings: 'workspaceId',
  FgosHours: 'workspaceId',
  Methodic: 'workspaceId',
  Course: 'workspaceId',
  CourseAssignment: 'workspaceId',
  // документохранилище
  File: 'workspaceId',
  DocVersion: 'workspaceId',
  Tag: 'workspaceId',
  Lens: 'workspaceId',
  Collection: 'workspaceId',
  CollectionFile: 'workspaceId',
  ShareGrant: 'workspaceId',
  // учебники / парсер (doc.file.enriched → textbook.parsed)
  Material: 'workspaceId',
  TextbookTopic: 'workspaceId',
  TextbookCard: 'workspaceId',
  // Communitoria (граф контактов + инварианты миноров)
  Parenthood: 'workspaceId',
  Channel: 'workspaceId',
  ChannelParticipant: 'workspaceId',
  // Communitoria (каналы/сообщения/объявления)
  Message: 'workspaceId',
  MessageReaction: 'workspaceId',
  Ack: 'workspaceId',
  // Пилотный auth (временный)
  PilotInvite: 'workspaceId',
  // ─── Schoolium 1.1.1: доменный контур версии (AR-2, AR-44) ───
  // Ключ тенанта стоит на КАЖДОЙ из одиннадцати доменных таблиц — без исключений.
  SchoolClass: 'workspaceId',
  StudentGroup: 'workspaceId',
  SchoolStudent: 'workspaceId',
  SchoolSubject: 'workspaceId',
  TeacherBinding: 'workspaceId',
  Term: 'workspaceId',
  ScheduleTemplate: 'workspaceId',
  TemplateSlot: 'workspaceId',
  SchoolLesson: 'workspaceId',
  Mark: 'workspaceId',
  LessonTopic: 'workspaceId',
  // проекции журнала: он строит их подпиской, но живут они у него и под тем же ключом
  JournalColumn: 'workspaceId',
  JournalRow: 'workspaceId',
  // регистр школы (версии агрегатов AR-109, параметры дня AR-103) — тоже школьный
  SchoolState: 'workspaceId',
  // ─── Schoolium 1.2.0: карточки родителей и связи с детьми (AR-155) ───
  GuardianCard: 'workspaceId',
  GuardianLink: 'workspaceId',
  // ─── Schoolium 1.1.1: контур доступа (правило изоляции AR-99) ───
  // Под guard: карточки персонала и все токены, выпущенные внутри школы.
  StaffCard: 'workspaceId',
  LoginCode: 'workspaceId',
  ActivationToken: 'workspaceId',
  BootstrapLink: 'workspaceId',
  // ВНЕ guard осознанно (AR-99), перечислено здесь же, чтобы решение было видно:
  //  - AppSession — читается ДО того, как тенант известен: это она его и называет;
  //    изоляция обеспечивается тем, что сессия несёт workspaceId и он становится
  //    тенантом запроса, а не тем, что таблицу фильтруют;
  //  - DeviceLinkToken — до подтверждения анонимен (его создаёт страница входа без
  //    сессии), workspaceId проставляется в момент привязки.
};
