import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { SessionUser } from '../../common/auth/flor.service';
import { OutboxDispatcher } from '../../common/outbox/outbox.dispatcher';
import { RequirePermission } from '../../common/authz/require-permission.decorator';
import { EngineService } from './engine.service';
import { IomService } from './iom.service';
import { AssessmentService } from './assessment.service';
import { JournalService, type PostGradeInput } from './journal.service';
import { AnalyticsService } from './analytics.service';

interface GenerateBody { classId: string; disciplineId: string }
interface PhaseBody { phase: string }
interface AttendanceBody { marks: { studentId: string; status: string; arrivalTime?: string }[] }
interface TopicProgressBody { topicId: string; timeSpent: number }
interface TopicCompleteBody { topicId: string }
interface PrintBody { type?: string }
interface CheckBody { results: { studentCode: string; score: number }[] }
interface KtpAdjustBody { lessonId: string; action: string; reason?: string }

// Движок планирования — /api/v1/edu/* (Архстандарт §2; глобальный префикс api → путь v1/edu).
@Controller('v1/edu')
export class EngineController {
  constructor(
    private readonly engine: EngineService,
    private readonly iom: IomService,
    private readonly assessment: AssessmentService,
    private readonly journal: JournalService,
    private readonly analytics: AnalyticsService,
    private readonly dispatcher: OutboxDispatcher,
  ) {}

  private actor(req: Request & { user?: SessionUser }): string {
    return req.user?.florusUserId ?? 'system';
  }

  // ─── КТП ───
  @Get('ktp')
  getKtp(@Query('classId') classId?: string, @Query('disciplineId') disciplineId?: string) {
    return this.engine.getKtp(classId, disciplineId);
  }

  /** Правка темы черновика КТП (завуч перед утверждением): часы/название; снимает hoursSource. */
  @RequirePermission('planning.ktp.edit')
  @Post('ktp/topics/:id')
  updateKtpTopic(@Param('id') id: string, @Body() body: { title?: string; fgosHours?: number }, @Req() req: Request & { user?: SessionUser }) {
    return this.engine.updateKtpTopic(id, body, this.actor(req));
  }

  /** Завуч утверждает КТП → ktp.approved → (inline) Solver раскладывает КПП (§7). */
  @RequirePermission('planning.ktp.approve')
  @Post('ktp/:id/approve')
  async approveKtp(@Param('id') id: string, @Req() req: Request & { user?: SessionUser }) {
    const res = await this.engine.approveKtp(id, this.actor(req));
    await this.dispatcher.drain(); // прогнать пайплайн: ktp.approved → генерация КПП
    // вернуть исход генерации (Solver может упасть на нехватке слотов — ошибка в логах,
    // здесь видно, собрался ли КПП); kpp=null → генерация не дала плана.
    const kpps = await this.engine.getKpp(res.classId, res.disciplineId);
    const kpp = kpps[0];
    // если событийная генерация не дала КПП — воспроизводим её синхронно, чтобы вернуть ПРИЧИНУ завучу
    // (код ConflictException: INSUFFICIENT_SLOTS / NO_TIMETABLE / KPP_IN_USE), а не молчаливый null.
    let reason: string | null = null;
    if (!kpp) {
      try {
        await this.engine.generateKpp(res.classId, res.disciplineId);
        // успех со второй попытки (редко) — перечитываем
        const again = (await this.engine.getKpp(res.classId, res.disciplineId))[0];
        return { id: res.id, status: res.status, kpp: again ? { id: again.id, status: again.status, lessonCount: again.lessons.length } : null, reason: null };
      } catch (e) {
        reason = (e as { response?: { code?: string } })?.response?.code ?? (e as Error).message ?? null;
      }
    }
    return {
      id: res.id,
      status: res.status,
      kpp: kpp ? { id: kpp.id, status: kpp.status, lessonCount: kpp.lessons.length } : null,
      reason,
    };
  }

  // ─── КПП ───
  @Get('kpp')
  getKpp(@Query('classId') classId?: string, @Query('disciplineId') disciplineId?: string) {
    return this.engine.getKpp(classId, disciplineId);
  }

  /** Внутренняя генерация (Solver); пайплайн делегирует сюда по ktp.approved. */
  @RequirePermission('planning.kpp.approve')
  @Post('kpp/generate')
  generateKpp(@Body() body: GenerateBody) {
    return this.engine.generateKpp(body.classId, body.disciplineId);
  }

  @RequirePermission('planning.kpp.approve')
  @Post('kpp/:id/approve')
  async approveKpp(@Param('id') id: string, @Req() req: Request & { user?: SessionUser }) {
    const res = await this.engine.approveKpp(id, this.actor(req));
    await this.dispatcher.drain();
    return res;
  }

  // ─── Timetable / Расписание ───
  @Get('timetable')
  getTimetable(@Query('classId') classId?: string) {
    return this.engine.getTimetable(classId);
  }

  /** AR-38: завуч сохраняет сетку класса (типовая неделя). Движок — единственный писатель. */
  @RequirePermission('schedule.build')
  @Post('timetable')
  async upsertTimetable(
    @Body() body: { classId: string; slots: { day: number; position: number; durationMin?: number }[] },
    @Req() req: Request & { user?: SessionUser },
  ) {
    const res = await this.engine.upsertTimetable(body.classId, body.slots ?? [], this.actor(req));
    await this.dispatcher.drain();
    return res;
  }

  @Get('schedule/me')
  scheduleMe(@Req() req: Request & { user?: SessionUser }) {
    return this.engine.scheduleMe(this.actor(req));
  }

  @Get('schedule/builder')
  scheduleBuilder() {
    return this.engine.scheduleBuilder();
  }

  @RequirePermission('schedule.build')
  @Post('schedule/build')
  async buildSchedule(@Req() req: Request & { user?: SessionUser }) {
    const res = await this.engine.buildSchedule(this.actor(req));
    await this.dispatcher.drain();
    return res;
  }

  // ─── Lesson FSM ───
  @Get('lessons/:id')
  getLesson(@Param('id') id: string) {
    return this.engine.getLesson(id);
  }

  @RequirePermission('lesson.conduct')
  @Post('lessons/:id/start')
  async start(@Param('id') id: string, @Req() req: Request & { user?: SessionUser }) {
    const res = await this.engine.startLesson(id, this.actor(req));
    await this.dispatcher.drain();
    return res;
  }

  @RequirePermission('lesson.conduct')
  @Post('lessons/:id/phase')
  setPhase(@Param('id') id: string, @Body() body: PhaseBody, @Req() req: Request & { user?: SessionUser }) {
    return this.engine.setPhase(id, body.phase, this.actor(req));
  }

  @RequirePermission('lesson.conduct')
  @Post('lessons/:id/complete')
  complete(@Param('id') id: string) {
    return this.engine.completeLesson(id);
  }

  // ─── Сигналы урока → ИОМ (inline-дренаж → аккумулятор обновляется сразу) ───
  @RequirePermission('lesson.conduct')
  @Post('lessons/:id/attendance')
  async attendance(@Param('id') id: string, @Body() body: AttendanceBody, @Req() req: Request & { user?: SessionUser }) {
    const res = await this.engine.markAttendance(id, body.marks, this.actor(req));
    await this.dispatcher.drain();
    return res;
  }

  @RequirePermission('lesson.conduct')
  @Post('lessons/:id/topic-progress')
  async topicProgress(@Param('id') id: string, @Body() body: TopicProgressBody, @Req() req: Request & { user?: SessionUser }) {
    const res = await this.engine.topicProgress(id, body.topicId, body.timeSpent, this.actor(req));
    await this.dispatcher.drain();
    return res;
  }

  @RequirePermission('lesson.conduct')
  @Post('lessons/:id/topic-complete')
  async topicComplete(@Param('id') id: string, @Body() body: TopicCompleteBody, @Req() req: Request & { user?: SessionUser }) {
    const res = await this.engine.topicComplete(id, body.topicId, this.actor(req));
    await this.dispatcher.drain();
    return res;
  }

  // ─── Петля летучки (Движок §5): печать(коды) → check(Tesseract-стаб) → assessment.checked → ИОМ ───
  @RequirePermission('lesson.conduct')
  @Post('lessons/:id/brief-test/print')
  async printBriefTest(@Param('id') id: string, @Body() body: PrintBody) {
    return this.assessment.print(id, body.type);
  }

  @RequirePermission('lesson.conduct')
  @Post('brief-test/:id/check')
  async checkBriefTest(@Param('id') id: string, @Body() body: CheckBody) {
    const res = await this.assessment.check(id, body.results);
    await this.dispatcher.drain(); // assessment.checked → ИОМ (летучка-компонент mastery)
    return res;
  }

  @Get('brief-test/:id')
  getBriefTest(@Param('id') id: string) {
    return this.assessment.get(id);
  }

  // ─── ИОМ-срез (UI учителя — реальные имена) ───
  @Get('iom/:studentId')
  getIom(@Param('studentId') studentId: string) {
    return this.iom.getIom(studentId);
  }

  // ─── Журнал: пишется ТОЛЬКО через grade.posted (явное действие учителя, реальный id) ───
  @RequirePermission('journal.grades.edit')
  @Post('journal/grade')
  async postGrade(@Body() body: PostGradeInput, @Req() req: Request & { user?: SessionUser }) {
    const res = await this.journal.postGrade(body, this.actor(req));
    await this.dispatcher.drain();
    return res;
  }

  @Get('journal')
  getJournal(@Query('classId') classId?: string, @Query('disciplineId') disciplineId?: string, @Query('period') period?: string) {
    return this.journal.getJournal(classId, disciplineId, period);
  }

  // ─── Персонализация §6: движок ПРЕДЛАГАЕТ, человек РЕШАЕТ (без авто-применения) ───
  @Get('analytics/class')
  classAnalytics(@Query('classId') classId: string, @Query('disciplineId') disciplineId: string) {
    return this.analytics.classAnalytics(classId, disciplineId);
  }

  @RequirePermission('planning.ktp.edit')
  @Post('analytics/ktp-adjust')
  async ktpAdjust(@Body() body: KtpAdjustBody, @Req() req: Request & { user?: SessionUser }) {
    const res = await this.analytics.proposeKtpAdjust(body.lessonId, body.action, this.actor(req), body.reason);
    await this.dispatcher.drain();
    return res;
  }
}
