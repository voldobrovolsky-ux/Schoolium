import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';

export interface MethodicInput { title: string; body?: string; disciplineId?: string }
export interface CourseInput { title: string; description?: string; disciplineId?: string }

/**
 * Кабинеты (Кабинеты_ТЗ §2-4), поверхность без внешних зависимостей: методкопилка/курсы/
 * курирование (методист пишет, учитель читает) + надзор завуча scope=school (чтение агрегатов).
 * Всё tenant-scoped guard'ом. materials/methodbank (Документохранилище), ai-query (LLM),
 * parse-review (парсер) — отложены до соответствующих модулей.
 */
@Injectable()
export class CabinetsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Методики (методист пишет, все читают) ───
  listMethodics(disciplineId?: string) {
    return this.prisma.methodic.findMany({ where: disciplineId ? { disciplineId } : {}, orderBy: { updatedAt: 'desc' } });
  }
  async getMethodic(id: string) {
    const m = await this.prisma.methodic.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('методика не найдена');
    return m;
  }
  createMethodic(input: MethodicInput, authorId: string) {
    return this.prisma.methodic.create({
      data: { workspaceId: TenantContext.require(), title: input.title, body: input.body ?? null, disciplineId: input.disciplineId ?? null, authorId },
    });
  }
  updateMethodic(id: string, input: Partial<MethodicInput>) {
    return this.prisma.methodic.update({
      where: { id },
      data: { title: input.title, body: input.body, disciplineId: input.disciplineId },
    });
  }

  // ─── Курсы (методист студия) + курирование ───
  listCourses(assignedTo?: string) {
    return this.prisma.course.findMany({
      where: assignedTo ? { assignments: { some: { teacherId: assignedTo } } } : {},
      include: { assignments: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  createCourse(input: CourseInput, authorId: string) {
    return this.prisma.course.create({
      data: { workspaceId: TenantContext.require(), title: input.title, description: input.description ?? null, disciplineId: input.disciplineId ?? null, authorId },
    });
  }
  async curationTeachers() {
    const teachers = await this.prisma.teacher.findMany({ include: { user: true } });
    const assignments = await this.prisma.courseAssignment.findMany({ include: { course: true } });
    return teachers.map((t) => ({
      id: t.id,
      name: t.user.displayName,
      courses: assignments.filter((a) => a.teacherId === t.id).map((a) => ({ id: a.courseId, title: a.course.title })),
    }));
  }
  assignCourse(teacherId: string, courseId: string, assignedBy: string) {
    const ws = TenantContext.require();
    return this.prisma.courseAssignment.upsert({
      where: { courseId_teacherId: { courseId, teacherId } },
      update: { assignedBy },
      create: { workspaceId: ws, courseId, teacherId, assignedBy },
    });
  }

  // ─── Надзор завуча (scope=school; всё tenant-scoped = своя школа) ───
  ktpSchool() {
    return this.prisma.ktp.findMany({ include: { topics: { orderBy: { order: 'asc' } } }, orderBy: { updatedAt: 'desc' } });
  }
  async journalsSchool() {
    const groups = await this.prisma.journalCell.groupBy({ by: ['classId', 'disciplineId'], _count: { id: true } });
    return groups.map((g) => ({ classId: g.classId, disciplineId: g.disciplineId, cells: g._count.id }));
  }
  async analyticsSchool() {
    const edges = await this.prisma.masteryEdge.findMany({ where: { score: { not: null } }, include: { competencyNode: true } });
    const byDiscipline: Record<string, number[]> = {};
    for (const e of edges) (byDiscipline[e.competencyNode.disciplineId] ??= []).push(e.score ?? 0);
    const disciplines = Object.entries(byDiscipline).map(([disciplineId, s]) => ({
      disciplineId,
      avgMasteryPct: Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 100),
      signals: s.length,
    }));
    const atRiskCount = edges.filter((e) => (e.score ?? 1) < 0.5 && e.confidence >= 0.5).length;
    return { disciplines, atRiskCount };
  }
}
