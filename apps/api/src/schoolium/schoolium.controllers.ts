import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type {
  AdminCabinetDto,
  AuditEntryDto,
  BindTeacherDto,
  ConfirmScheduleDto,
  CreateClassesDto,
  CreateGuardianDto,
  CreateStaffCardDto,
  CreateSubjectDto,
  DayParamsDto,
  FillStaffCardDto,
  MarkValue,
  SchoolRole,
  SetLoadDto,
  SetPrioritiesDto,
  SetTermsDto,
  UpsertStudentDto,
} from '@edustore/shared';
import { RequirePermission } from '../common/authz/require-permission.decorator';
import { Public } from '../common/auth/public.decorator';
import { SCHOOL_COOKIE, schoolCookieOptions } from '../common/auth/school-session.service';
import type { SessionUser } from '../common/auth/flor.service';
import { actorOf } from './actor';
import { schoolToday } from './calendar/school-day';
import { ContingentService } from './contingent/contingent.service';
import { SubjectsService } from './subjects/subjects.service';
import { StaffService } from './staff/staff.service';
import { AccountsService } from './access/accounts.service';
import { DiaryService } from './diary/diary.service';
import { SchoolError } from './schoolium.errors';
import { CalendarContractService, CalendarService } from './calendar/calendar.service';
import { ScheduleService } from './schedule/schedule.service';
import { JournalService } from './journal/journal.service';
import { SchoolStateService } from './school-state.service';
import { AUDIT_LABELS, type SchoolEventType } from './schoolium.contract';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';

type Req0 = Request & { user?: SessionUser };

/**
 * Контроллеры Schoolium 1.1.1. Каждая мутация несёт `@RequirePermission` из
 * каталога (AR-35, ворота G-10) и соответствует СТРОКЕ таблицы `70-screens.md`
 * §11: действия, которого в таблице нет, в версии не существует.
 *
 * Роль в колонке «Право» — МИНИМАЛЬНАЯ. Модератор проходит каждую строку
 * (AR-88); отказ по праву он получить не может, отказ по факту
 * (`LESSON_NOT_HELD`, `TOKEN_USED`, `CONCURRENT_EDIT`) — может, и это разные вещи.
 */

// ─────────────────────────── контингент ───────────────────────────

@Controller('v1/classes')
export class ClassesController {
  constructor(
    private readonly svc: ContingentService,
    private readonly state: SchoolStateService,
  ) {}

  /** `S-10.grid.classes`. Читают все шесть ролей. */
  @RequirePermission('classes.read')
  @Get()
  async list() {
    const [classes, reg] = await Promise.all([this.svc.listClasses(), this.state.register()]);
    return { classes, version: reg.contingentVersion };
  }

  @RequirePermission('classes.read')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.getClass(id);
  }

  @RequirePermission('classes.read')
  @Get(':id/students')
  students(@Param('id') id: string) {
    return this.svc.listStudents(id);
  }

  /** §11 строка 8 · `S-11.btn.create`: мастер создаёт классы пачкой. */
  @RequirePermission('contingent.write')
  @Post('bulk')
  bulk(@Req() req: Req0, @Body() body: CreateClassesDto) {
    return this.svc.createClasses(body, actorOf(req));
  }

  /** §11 строка 9 · `S-12.btn.addStudent`. */
  @RequirePermission('contingent.write')
  @Post(':id/students')
  addStudent(@Req() req: Req0, @Param('id') id: string, @Body() body: UpsertStudentDto) {
    return this.svc.addStudent(id, body, actorOf(req));
  }

  /** §11 строка 26 · `S-12.btn.deleteClass`: необратимо, объём назван (AR-105). */
  @RequirePermission('contingent.write')
  @Delete(':id')
  removeClass(@Req() req: Req0, @Param('id') id: string) {
    return this.svc.deleteClass(id, actorOf(req));
  }
}

@Controller('v1/students')
export class StudentsController {
  constructor(
    private readonly svc: ContingentService,
    private readonly accounts: AccountsService,
  ) {}

  @RequirePermission('classes.read')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.getStudent(id);
  }

  /** §11 строка 10 · `S-13.btn.save`. */
  @RequirePermission('contingent.write')
  @Put(':id')
  update(@Req() req: Req0, @Param('id') id: string, @Body() body: UpsertStudentDto) {
    return this.svc.updateStudent(id, body, actorOf(req));
  }

  /** §11 строка 11 · `S-12.btn.deleteStudent` — только у записи без отметок. */
  @RequirePermission('contingent.write')
  @Delete(':id')
  remove(@Req() req: Req0, @Param('id') id: string) {
    return this.svc.deleteStudent(id, actorOf(req));
  }

  /** §11 строка 12 · `S-12.btn.deactivateStudent` — история сохраняется. */
  @RequirePermission('contingent.write')
  @Post(':id/deactivate')
  deactivate(@Req() req: Req0, @Param('id') id: string) {
    return this.svc.deactivateStudent(id, actorOf(req));
  }

  /** §11 строка 27 · `S-12.btn.reactivateStudent`. */
  @RequirePermission('contingent.write')
  @Post(':id/reactivate')
  reactivate(@Req() req: Req0, @Param('id') id: string) {
    return this.svc.reactivateStudent(id, actorOf(req));
  }

  // ─── доступ ученика 1.2.0 (AR-155): та же механика, что у персонала ───

  @RequirePermission('classes.read')
  @Get(':id/access')
  access(@Param('id') id: string) {
    return this.accounts.studentAccess(id);
  }

  /** `S-13.btn.createAccess`: ФИО уже в записи, модератор задаёт только креды. */
  @RequirePermission('contingent.write')
  @Post(':id/access')
  createAccess(@Param('id') id: string, @Body() body: { username?: string | null; password?: string | null }) {
    return this.accounts.createStudentAccess(id, body ?? {});
  }

  @RequirePermission('classes.read')
  @Get(':id/activation-token')
  activationStatus(@Param('id') id: string) {
    return this.accounts.studentActivationStatus(id);
  }

  /** `S-13.qr`: именной QR ученика (AR-161). */
  @RequirePermission('contingent.write')
  @Post(':id/activation-token')
  activationToken(@Param('id') id: string) {
    return this.accounts.studentActivationToken(id);
  }

  /** `S-13.btn.revokeActivation` (AR-153). */
  @RequirePermission('contingent.write')
  @Post(':id/revoke-activation')
  revokeActivation(@Req() req: Req0, @Param('id') id: string) {
    return this.accounts.revokeStudentActivation(id, actorOf(req));
  }

  @RequirePermission('contingent.write')
  @Post(':id/credentials')
  credentials(@Param('id') id: string) {
    return this.accounts.studentCredentials(id);
  }
}

// ─────────────────────────── родители (S-14, AR-155) ───────────────────────────

@Controller('v1/guardians')
export class GuardiansController {
  constructor(private readonly accounts: AccountsService) {}

  @RequirePermission('classes.read')
  @Get()
  list() {
    return this.accounts.listGuardians();
  }

  /** `S-14.btn.addGuardian`: учётка + связи с детьми, креды в ответе один раз. */
  @RequirePermission('contingent.write')
  @Post()
  create(@Body() body: CreateGuardianDto) {
    return this.accounts.createGuardian(body);
  }

  @RequirePermission('classes.read')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.accounts.getGuardian(id);
  }

  @RequirePermission('contingent.write')
  @Delete(':id')
  remove(@Req() req: Req0, @Param('id') id: string) {
    return this.accounts.removeGuardian(id, actorOf(req));
  }

  /** Связи родитель→ребёнок ведёт модератор вручную (решение владельца 2026-08-28). */
  @RequirePermission('contingent.write')
  @Post(':id/links')
  addLink(@Param('id') id: string, @Body() body: { studentId: string }) {
    return this.accounts.addLink(id, String(body?.studentId ?? ''));
  }

  @RequirePermission('contingent.write')
  @Delete(':id/links/:sid')
  removeLink(@Param('id') id: string, @Param('sid') sid: string) {
    return this.accounts.removeLink(id, sid);
  }

  @RequirePermission('classes.read')
  @Get(':id/activation-token')
  activationStatus(@Param('id') id: string) {
    return this.accounts.guardianActivationStatus(id);
  }

  @RequirePermission('contingent.write')
  @Post(':id/activation-token')
  activationToken(@Param('id') id: string) {
    return this.accounts.guardianActivationToken(id);
  }

  @RequirePermission('contingent.write')
  @Post(':id/revoke-activation')
  revokeActivation(@Req() req: Req0, @Param('id') id: string) {
    return this.accounts.revokeGuardianActivation(id, actorOf(req));
  }

  @RequirePermission('contingent.write')
  @Post(':id/credentials')
  credentials(@Param('id') id: string) {
    return this.accounts.guardianCredentials(id);
  }
}

// ─────────────────────── дневник и успеваемость (S-90, S-91) ───────────────────────

/**
 * Проекции ученика и родителя (AR-158, AR-159). Гейт — идентичность, а не
 * каталог (AR-151): экран отдаёт ровно детей учётки; штатная роль со связью
 * `GuardianLink` видит своих детей без роли `parent`. Мутаций нет ни одной
 * (G-67); в воротах G-10 маршруты не участвуют — это чтения.
 */
@Controller('v1/diary')
export class DiaryController {
  constructor(private readonly svc: DiaryService) {}

  @Get('children')
  children(@Req() req: Req0) {
    const u = req.user;
    if (!u?.workspaceId) throw new SchoolError('ACCESS_REVOKED');
    return this.svc.childrenOf(u.florusUserId);
  }

  @Get()
  week(@Req() req: Req0, @Query('child') child?: string, @Query('week') week?: string) {
    const u = req.user;
    if (!u?.workspaceId) throw new SchoolError('ACCESS_REVOKED');
    return this.svc.week(u.florusUserId, child || null, week || null);
  }

  @Get('averages')
  averages(@Req() req: Req0, @Query('child') child?: string) {
    const u = req.user;
    if (!u?.workspaceId) throw new SchoolError('ACCESS_REVOKED');
    return this.svc.averages(u.florusUserId, child || null);
  }
}

// ─────────────────── «Не авторизованные» (S-32) ───────────────────

@Controller('v1/access')
export class PendingController {
  constructor(private readonly accounts: AccountsService) {}

  /** Рабочий экран модератора на событии: заведено, но не активировано. */
  @RequirePermission('school.manage')
  @Get('pending')
  pending() {
    return this.accounts.pending();
  }
}

// ─────────────────────────── предметы ───────────────────────────

@Controller('v1/subjects')
export class SubjectsController {
  constructor(private readonly svc: SubjectsService) {}

  @RequirePermission('subjects.read')
  @Get()
  list() {
    return this.svc.list();
  }

  /** `S-23` (AR-160): массовое создание типовых предметов, идемпотентно (G-70). */
  @RequirePermission('subject.write')
  @Post('preset')
  preset() {
    return this.svc.applyPreset();
  }

  /**
   * `S-70`: педагог сканирует QR привязки из личного кабинета. Строки в §11 у
   * операции нет намеренно — она identity-gated: человек отмечает СВОЙ скан
   * своей сессией, а не ведёт школу. Права из каталога она не несёт по той же
   * причине, что выход из сессии; в воротах G-10 у неё строка whitelist.
   */
  @Post('scan')
  scan(@Req() req: Req0, @Body() body: { token: string }) {
    return this.svc.scan(body.token, actorOf(req));
  }

  @RequirePermission('subjects.read')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  /** Поллинг статуса токена привязки раз в 2 секунды (AR-87). */
  @RequirePermission('subjects.read')
  @Get(':id/bind-token')
  bindStatus(@Param('id') id: string) {
    return this.svc.bindTokenStatus(id);
  }

  /** §11 строка 13 · `M-03`. */
  @RequirePermission('subject.write')
  @Post()
  create(@Body() body: CreateSubjectDto) {
    return this.svc.create(body);
  }

  /** §11 строка 14 · `S-22.qr`. */
  @RequirePermission('subject.write')
  @Post(':id/bind-token')
  bindToken(@Param('id') id: string) {
    return this.svc.createBindToken(id);
  }

  /** §11 строка 15 · `S-22.btn.confirm`. */
  @RequirePermission('subject.write')
  @Post(':id/teachers')
  bind(@Req() req: Req0, @Param('id') id: string, @Body() body: BindTeacherDto) {
    return this.svc.bindTeacher(id, body, actorOf(req));
  }

  /** §11 строка 16 · `S-21.btn.unbind`. */
  @RequirePermission('subject.write')
  @Delete(':id/teachers/:tid')
  unbind(@Req() req: Req0, @Param('id') id: string, @Param('tid') tid: string) {
    return this.svc.unbind(id, tid, actorOf(req));
  }

  /** §11 строка 28 · `S-21.btn.deleteSubject`. */
  @RequirePermission('subject.write')
  @Delete(':id')
  remove(@Req() req: Req0, @Param('id') id: string) {
    return this.svc.remove(id, actorOf(req));
  }
}

// ─────────────────────────── персонал ───────────────────────────

@Controller('v1/staff')
export class StaffController {
  constructor(private readonly svc: StaffService) {}

  @RequirePermission('staff.read')
  @Get()
  list() {
    return this.svc.list();
  }

  /**
   * §11 строка 5 · активация одним сканом (AR-161): учётка заведена модератором
   * целиком, человек не вводит ничего — скан именного QR и есть «я — это я».
   * Аноним с одноразовым токеном; доверие даёт живая сессия модератора и
   * физическое присутствие (AR-76). Сессия выдаётся, только если страницу
   * открыл сам человек (AR-91).
   */
  @Public()
  @Post('join/:token')
  async join(@Req() req: Req0, @Param('token') token: string) {
    const openedByOtherSession = Boolean(req.cookies?.[SCHOOL_COOKIE]);
    const ua = String(req.headers['user-agent'] ?? '');
    const r = await this.svc.activate(token, { openedByOtherSession, deviceHint: ua.slice(0, 80) });
    if (r.sessionToken) {
      (req.res as import('express').Response).cookie(SCHOOL_COOKIE, r.sessionToken, {
        ...schoolCookieOptions(),
        path: '/',
      });
    }
    return { ok: true, hasSession: Boolean(r.sessionToken) };
  }

  /** §11 строка 6 · `S-04.btn.attach`: собственная аватарка. */
  @RequirePermission('staff.self.write')
  @Post('me/avatar')
  setAvatar(@Req() req: Req0, @Body() body: { url: string }) {
    return this.svc.setAvatar(actorOf(req).userId, body.url);
  }

  /** §11 строка 33 · `M-15`: удаление собственной аватарки. */
  @RequirePermission('staff.self.write')
  @Delete('me/avatar')
  clearAvatar(@Req() req: Req0) {
    return this.svc.clearAvatar(actorOf(req).userId);
  }

  /** Живая проверка занятости юзернейма. Стоит ДО `:id` — иначе перехватится им. */
  @RequirePermission('staff.manage')
  @Get('username-free')
  usernameFree(@Query('u') u: string) {
    return this.svc.usernameFree(String(u ?? ''));
  }

  @RequirePermission('staff.read')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  /** Поллинг статуса QR активации раз в 2 секунды, пока карточка открыта (AR-87). */
  @RequirePermission('staff.read')
  @Get(':id/activation-token')
  activationStatus(@Param('id') id: string) {
    return this.svc.activationStatus(id);
  }

  /**
   * `S-30.btn.addFounder` / `S-30.btn.addTeacher`: карточка + учётка сразу
   * (AR-154): ФИО, юзернейм (пустой — транслитерация), пароль (пустой —
   * генерация). Пароль в ответе — открытым текстом, ОДИН раз.
   */
  @RequirePermission('staff.manage')
  @Post('cards')
  addCard(@Body() body: CreateStaffCardDto) {
    return this.svc.addCard(body);
  }

  /** Заполнение пустой карточки-слота (синглтоны из bootstrap). */
  @RequirePermission('staff.manage')
  @Post(':id/fill')
  fillCard(@Param('id') id: string, @Body() body: FillStaffCardDto) {
    return this.svc.fillCard(id, body);
  }

  /** `S-31.btn.reissuePassword`: новый пароль, показан один раз. */
  @RequirePermission('staff.manage')
  @Post(':id/credentials')
  regenerateCredentials(@Param('id') id: string) {
    return this.svc.regenerateCredentials(id);
  }

  /** `S-31.btn.revokeActivation` (AR-153): «просканировал не тот». */
  @RequirePermission('staff.manage')
  @Post(':id/revoke-activation')
  revokeActivation(@Req() req: Req0, @Param('id') id: string) {
    return this.svc.revokeActivation(id, actorOf(req));
  }


  /** §11 строка 4 · `S-31.qr`. */
  @RequirePermission('staff.manage')
  @Post(':id/activation-token')
  activationToken(@Param('id') id: string) {
    return this.svc.createActivationToken(id);
  }

  /** `S-31.btn.close`: закрытие карточки гасит QR (AR-76). */
  @RequirePermission('staff.manage')
  @Post(':id/close')
  close(@Param('id') id: string) {
    return this.svc.closeCard(id);
  }

  /** §11 строка 7 · `S-31.btn.addRole` — так появляется второй модератор (AR-102). */
  @RequirePermission('staff.manage')
  @Post(':id/roles')
  addRole(@Req() req: Req0, @Param('id') id: string, @Body() body: { role: SchoolRole }) {
    return this.svc.addRole(id, body.role, actorOf(req));
  }

  /** §11 строка 32 · `S-31.btn.removeRole`: `LAST_MODERATOR` / `LAST_ROLE`. */
  @RequirePermission('staff.manage')
  @Delete(':id/roles/:role')
  removeRole(@Req() req: Req0, @Param('id') id: string, @Param('role') role: SchoolRole) {
    return this.svc.removeRole(id, role, actorOf(req));
  }

  /** §11 строка 29 · `S-31.btn.deactivateStaff`. */
  @RequirePermission('staff.manage')
  @Post(':id/deactivate')
  deactivate(@Req() req: Req0, @Param('id') id: string) {
    return this.svc.deactivate(id, actorOf(req));
  }

  /** §11 строка 30 · `S-31.btn.reactivateStaff`. */
  @RequirePermission('staff.manage')
  @Post(':id/reactivate')
  reactivate(@Req() req: Req0, @Param('id') id: string) {
    return this.svc.reactivate(id, actorOf(req));
  }

  /** §11 строка 31 · `S-31.btn.deleteStaff`. */
  @RequirePermission('staff.manage')
  @Delete(':id')
  remove(@Req() req: Req0, @Param('id') id: string) {
    return this.svc.remove(id, actorOf(req));
  }

  /** §11 строка 35 · `S-31.btn.loginCode`: восстановление доступа (AR-92). */
  @RequirePermission('staff.manage')
  @Post(':id/login-code')
  loginCode(@Param('id') id: string) {
    return this.svc.issueLoginCode(id);
  }

  /** §11 строка 37 · `S-31.btn.revokeSessions`. */
  @RequirePermission('staff.manage')
  @Post(':id/sessions/revoke')
  revokeSessions(@Req() req: Req0, @Param('id') id: string) {
    return this.svc.revokeSessions(id, actorOf(req));
  }
}

// ─────────────────────────── календарь и расписание ───────────────────────────

@Controller('v1/calendar')
export class CalendarController {
  constructor(private readonly svc: CalendarService) {}

  @RequirePermission('schedule.read')
  @Get('terms')
  async terms() {
    const rows = await this.svc.listTerms();
    return rows.map((t) => ({
      termNo: t.termNo,
      dateFrom: t.dateFrom.toISOString().slice(0, 10),
      dateTo: t.dateTo.toISOString().slice(0, 10),
    }));
  }

  /** §11 строка 17 · `S-41` экран 1: даты уходят В КАЛЕНДАРЬ, а не в модалку. */
  @RequirePermission('schedule.build')
  @Put('terms')
  setTerms(@Req() req: Req0, @Body() body: SetTermsDto) {
    return this.svc.setTerms(body.terms, actorOf(req));
  }
}

@Controller('v1/schedule')
export class ScheduleController {
  constructor(private readonly svc: ScheduleService) {}

  /** `S-40.grid.week` — вид сетки и её статус (в том числе плашка «устарело»). */
  @RequirePermission('schedule.read')
  @Get()
  week() {
    return this.svc.week();
  }

  @RequirePermission('schedule.read')
  @Get('load')
  load() {
    return this.svc.load();
  }

  /** §11 строка 18 · `S-41` экран 2. Несёт версию агрегата (AR-109). */
  @RequirePermission('schedule.build')
  @Put('load')
  setLoad(@Req() req: Req0, @Body() body: SetLoadDto) {
    return this.svc.setLoad(body, actorOf(req));
  }

  /** §11 строка 19 · `S-41` экран 3. */
  @RequirePermission('schedule.build')
  @Put('priorities')
  setPriorities(@Body() body: SetPrioritiesDto) {
    return this.svc.setPriorities(body);
  }

  /** §11 строка 20 · `S-41` экран 4. Несёт версию агрегата (AR-109). */
  @RequirePermission('schedule.build')
  @Put('day-params')
  setDayParams(@Req() req: Req0, @Body() body: DayParamsDto) {
    return this.svc.setDayParams(body, actorOf(req));
  }

  /** §11 строка 21 · `S-41.btn.generate`: результат — предложение (AR-18). */
  @RequirePermission('schedule.build')
  @Post('generate')
  generate(@Req() req: Req0) {
    return this.svc.generate(actorOf(req));
  }

  /** §11 строка 34 · `S-42.btn.cancelGen`: школа остаётся в `day_params_set`. */
  @RequirePermission('schedule.build')
  @Post('generate/cancel')
  cancel() {
    return this.svc.cancelGeneration();
  }

  @RequirePermission('schedule.read')
  @Get('preview')
  preview() {
    return this.svc.preview();
  }

  /** §11 строка 22 · `S-42.btn.confirm` — единственный путь к материализации. */
  @RequirePermission('schedule.build')
  @Post('confirm')
  confirm(@Req() req: Req0, @Body() body: ConfirmScheduleDto) {
    return this.svc.confirm(body, actorOf(req));
  }
}

// ─────────────────────────── журнал ───────────────────────────

@Controller('v1')
export class SchoolJournalController {
  constructor(
    private readonly svc: JournalService,
    private readonly schedule: ScheduleService,
    private readonly calendar: CalendarContractService,
  ) {}

  /**
   * `S-50`. Открытие журнала — третий триггер материализации (AR-101): если
   * горизонт короче трёх недель, он дозаполняется по запросу. Операция
   * идемпотентна, поэтому триггеры не конфликтуют.
   */
  @RequirePermission('journal.read')
  @Get('journal')
  async journal(
    @Query('classId') classId: string,
    @Query('subjectId') subjectId: string,
    @Query('week') week?: string,
  ) {
    await this.schedule.materialize('journal-open');
    const today = schoolToday();
    const holidays = await this.calendar.onHolidays(today);
    const nextDay = holidays ? await this.calendar.nextSchoolDay(today) : null;
    // `week` — понедельник открываемой недели. Отсутствует или не из этого
    // учебного года — сервер сам выбирает текущую и говорит об этом
    // (`openWeekReason`), а не молча показывает первую попавшуюся.
    return this.svc.read(classId, subjectId, nextDay, week);
  }

  /** §11 строка 23 · `S-51.btn.save`. */
  @RequirePermission('journal.topic.set')
  @Put('lessons/:id/topic')
  setTopic(@Req() req: Req0, @Param('id') id: string, @Body() body: { topic: string }) {
    const a = actorOf(req);
    return this.svc.setTopic(id, body.topic, { userId: a.userId, roles: a.roles, name: a.name });
  }

  /** §11 строка 24 · `S-52`: педагог — свой урок, модератор — любой (AR-88). */
  @RequirePermission('journal.mark.post')
  @Post('lessons/:id/marks')
  postMark(@Req() req: Req0, @Param('id') id: string, @Body() body: { studentId: string; mark: MarkValue }) {
    const a = actorOf(req);
    return this.svc.postMark(id, body.studentId, body.mark, { userId: a.userId, roles: a.roles, name: a.name });
  }

  /** §11 строка 25 · `S-52.btn.clear`: снятие отметки — именное (AR-88). */
  @RequirePermission('journal.mark.post')
  @Delete('lessons/:id/marks/:studentId')
  removeMark(@Req() req: Req0, @Param('id') id: string, @Param('studentId') studentId: string) {
    const a = actorOf(req);
    return this.svc.removeMark(id, studentId, { userId: a.userId, roles: a.roles, name: a.name });
  }
}

// ─────────────────────────── кабинет модератора ───────────────────────────

@Controller('v1/admin')
export class SchoolAdminController {
  constructor(
    private readonly state: SchoolStateService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * `S-60`. Роли, кроме модератора, получают 403 — не пустую страницу и не
   * молчаливый редирект (`70-screens.md`, `S-60`).
   *
   * Аудит здесь — не украшение, а противовес полным правам (AR-88): модератор
   * видит собственный след теми же словами, какими его увидит проверяющий.
   */
  @RequirePermission('school.manage')
  @Get()
  async cabinet(@Req() req: Req0): Promise<AdminCabinetDto> {
    const actor = actorOf(req);
    const [state, rows] = await Promise.all([this.state.resolve(), this.audit.listByActor(actor.userId, 100)]);
    const subjectIds = [...new Set(rows.map((r) => r.subjectUserId).filter((v): v is string => Boolean(v)))];
    const names = await this.resolveNames(subjectIds);
    const audit: AuditEntryDto[] = rows.map((r) => {
      const label = AUDIT_LABELS[r.action as SchoolEventType];
      return {
        id: r.id,
        at: r.occurredAt.toISOString(),
        action: r.action,
        // Событие вне каталога версии (легаси-контур) не прячется и не
        // подписывается выдумкой — показывается своим техническим именем.
        actionLabel: label?.action ?? r.action,
        objectKind: label?.object ?? 'запись',
        objectName: r.subjectUserId ? (names.get(r.subjectUserId) ?? null) : null,
      };
    });
    return { state, audit };
  }

  /** Субъект ПДн — либо ученик, либо сотрудник: аудит хранит идентификатор, имя живёт в своём контуре. */
  private async resolveNames(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    const [students, users] = await Promise.all([
      this.prisma.schoolStudent.findMany({ where: { id: { in: ids } } }),
      this.prisma.user.findMany({ where: { id: { in: ids } } }),
    ]);
    for (const s of students) out.set(s.id, [s.lastName, s.firstName, s.middleName].filter(Boolean).join(' '));
    for (const u of users) out.set(u.id, [u.lastName, u.firstName, u.middleName].filter(Boolean).join(' ') || u.displayName);
    return out;
  }
}
