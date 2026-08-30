import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { ConsentService } from '../consent/consent.service';

// Веса формулы mastery v1 (Движок §4): 0.6·летучка + 0.25·темы + 0.15·присутствие.
// Затухание сигналов 60 дней (полупериод) — стаб v1 (нужны per-signal timestamps).
const W_BRIEF = 0.6;
const W_TOPICS = 0.25;
const W_ATT = 0.15;

interface SignalRefs {
  brief?: number; // последний балл летучки, нормализованный 0..1
  topics?: Record<string, true>; // завершённые темы (topicId) — идемпотентно
  attendance?: Record<string, string>; // lessonId → статус — идемпотентно (overwrite)
}

/**
 * ИОМ-аккумулятор (Движок §4): единственный аккумулятор сигналов, read-model (не эмитит).
 * Хранит по РЕАЛЬНОМУ studentId. Идемпотентность — ключами внутри signalRefs (повтор сигнала
 * по тому же lessonId/topicId не двоит). Гейт id→code применяется на ИИ-границе (analytics), не здесь.
 */
@Injectable()
export class IomService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
  ) {}

  private async arOfLesson(lessonId: string): Promise<{ disciplineId: string; arCodes: string[] } | null> {
    const l = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { kppLesson: { include: { topic: true } } },
    });
    if (!l?.kppLesson) return null;
    return { disciplineId: l.subjectId, arCodes: l.kppLesson.topic.arCodes };
  }

  private compute(refs: SignalRefs, expectedTopics: number): { score: number; confidence: number } {
    const topicsDone = Object.keys(refs.topics ?? {}).length;
    const att = Object.values(refs.attendance ?? {});
    const present = att.filter((s) => s !== 'н').length; // присут/опоздал/удалённо — присутствие
    const briefComp = refs.brief ?? 0;
    const topicsComp = expectedTopics > 0 ? Math.min(1, topicsDone / expectedTopics) : 0;
    const attComp = att.length > 0 ? present / att.length : 0;
    const score = W_BRIEF * briefComp + W_TOPICS * topicsComp + W_ATT * attComp;
    const nSignals = (refs.brief != null ? 1 : 0) + topicsDone + att.length;
    return { score, confidence: Math.min(1, nSignals / 3) };
  }

  private async apply(
    ws: string,
    studentId: string,
    arCode: string,
    disciplineId: string,
    mutate: (r: SignalRefs) => void,
  ) {
    const node = await this.prisma.competencyNode.upsert({
      where: { workspaceId_fgosArCode_disciplineId: { workspaceId: ws, fgosArCode: arCode, disciplineId } },
      update: {},
      create: { workspaceId: ws, fgosArCode: arCode, disciplineId, label: arCode },
    });
    const existing = await this.prisma.masteryEdge.findUnique({
      where: { workspaceId_studentId_competencyNodeId: { workspaceId: ws, studentId, competencyNodeId: node.id } },
    });
    const refs: SignalRefs = (existing?.signalRefs as SignalRefs) ?? {};
    mutate(refs);
    const expectedTopics = await this.prisma.ktpTopic.count({ where: { arCodes: { has: arCode } } });
    const { score, confidence } = this.compute(refs, expectedTopics || 1);
    await this.prisma.masteryEdge.upsert({
      where: { workspaceId_studentId_competencyNodeId: { workspaceId: ws, studentId, competencyNodeId: node.id } },
      update: { score, confidence, signalRefs: refs as Prisma.InputJsonValue },
      create: { workspaceId: ws, studentId, competencyNodeId: node.id, score, confidence, signalRefs: refs as Prisma.InputJsonValue },
    });
  }

  // ─── ингест сигналов (вызывается из iom.handlers в тенант-контексте события) ───
  async onAttendance(lessonId: string, marks: { studentId: string; status: string }[]) {
    const ws = TenantContext.require();
    const ar = await this.arOfLesson(lessonId);
    if (!ar) return;
    for (const m of marks)
      for (const code of ar.arCodes)
        await this.apply(ws, m.studentId, code, ar.disciplineId, (r) => {
          (r.attendance ??= {})[lessonId] = m.status;
        });
  }

  async onTopicCompleted(lessonId: string, topicId: string) {
    const ws = TenantContext.require();
    const topic = await this.prisma.ktpTopic.findUnique({ where: { id: topicId } });
    const lesson = await this.prisma.lesson.findUnique({ where: { id: lessonId } });
    if (!topic || !lesson) return;
    const students = await this.prisma.student.findMany({ where: { classId: lesson.classId }, select: { id: true } });
    for (const s of students)
      for (const code of topic.arCodes)
        await this.apply(ws, s.id, code, lesson.subjectId, (r) => {
          (r.topics ??= {})[topicId] = true;
        });
  }

  /**
   * assessment.checked (петля летучки): летучка-компонент по arCode урока. Гейт §3 «граница 1»:
   * payload несёт studentCode → ИОМ резолвит code→studentId по карте BriefTestCode на ингесте.
   */
  async onAssessmentChecked(briefTestId: string, lessonId: string, results: { studentCode: string; score: number }[]) {
    const ws = TenantContext.require();
    const ar = await this.arOfLesson(lessonId);
    if (!ar) return;
    for (const r of results) {
      const map = await this.prisma.briefTestCode.findUnique({
        where: { briefTestId_studentCode: { briefTestId, studentCode: r.studentCode } },
      });
      if (!map) continue; // код не резолвится — пропуск
      for (const code of ar.arCodes)
        await this.apply(ws, map.studentId, code, ar.disciplineId, (rf) => (rf.brief = r.score));
    }
  }

  /** Срез ИОМ. UI учителя — реальные имена (авторизован); ИИ-граница — гейт в analytics. */
  async getIom(studentId: string) {
    // AR-29: персональный срез ИОМ = профилирование → требуется predictive_profiling-согласие.
    // Отказ ЯВНЫЙ (код NO_PROFILING_CONSENT), не пустой ответ — UI показывает причину.
    if (!(await this.consent.has(studentId, 'predictive_profiling'))) {
      throw new ForbiddenException({
        code: 'NO_PROFILING_CONSENT',
        message: 'нет согласия на профилирование (152-ФЗ §6.3) — срез ИОМ недоступен',
      });
    }
    const edges = await this.prisma.masteryEdge.findMany({
      where: { studentId },
      include: { competencyNode: true },
      orderBy: { updatedAt: 'desc' },
    });
    const interests = await this.prisma.interestEdge.findMany({ where: { studentId }, include: { interestNode: true } });
    return {
      studentId,
      competencies: edges.map((e) => ({
        arCode: e.competencyNode.fgosArCode,
        disciplineId: e.competencyNode.disciplineId,
        score: e.score, // null = unknown (cold-start)
        confidence: e.confidence,
      })),
      interests: interests.map((i) => ({ label: i.interestNode.label, weight: i.weight })),
    };
  }
}
