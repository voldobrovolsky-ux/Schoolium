import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  NotificationDto,
  TeacherClass,
  TeacherProfile,
} from '@edustore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Домен «учитель»: его флажки (классы×предметы) и профиль верхней панели. */
@Injectable()
export class TeacherService {
  constructor(private readonly prisma: PrismaService) {}

  /** Назначения учителя → флажки TeacherClass (с числом учеников в классе). */
  async getClasses(teacherId: string): Promise<TeacherClass[]> {
    const assignments = await this.prisma.teachingAssignment.findMany({
      where: { teacherId },
      include: {
        subject: true,
        class: { include: { _count: { select: { students: true } } } },
      },
    });

    return assignments.map((a) => ({
      id: a.id,
      classId: a.classId,
      label: a.class.label,
      subject: a.subject.name,
      subjectId: a.subjectId,
      students: a.class._count.students,
    }));
  }

  /** Профиль учителя для шапки (инициалы вычисляются из displayName). */
  async getProfile(teacherId: string): Promise<TeacherProfile> {
    const teacher = await this.prisma.teacher.findUnique({
      where: { id: teacherId },
      include: { user: true },
    });
    if (!teacher) {
      throw new NotFoundException(`Учитель ${teacherId} не найден`);
    }

    return {
      id: teacher.id,
      displayName: teacher.user.displayName,
      role: 'учитель математики',
      initials: initialsFrom(teacher.user.displayName),
      isCurator: teacher.isCurator,
    };
  }

  /** Уведомления учителя (свежие сверху); time — человекочитаемое «N назад». */
  async getNotifications(teacherId: string): Promise<NotificationDto[]> {
    const items = await this.prisma.notification.findMany({
      where: { teacherId },
      orderBy: { createdAt: 'desc' },
    });

    return items.map((n) => ({
      id: n.id,
      type: n.type,
      category: n.category,
      title: n.title,
      message: n.message,
      time: relativeTime(n.createdAt),
      icon: n.icon ?? 'info',
    }));
  }
}

/** "5 мин назад" / "2 ч назад" / "3 дн назад" из времени создания. */
function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const min = Math.max(1, Math.round(diffMs / 60000));
  if (min < 60) return `${min} мин назад`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.round(hours / 24);
  return `${days} дн назад`;
}

/** "Анна Соколова" → "АС". */
function initialsFrom(displayName: string): string {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
