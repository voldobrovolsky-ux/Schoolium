import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { newEvent } from '../../common/events/domain-event';
import { DocService } from '../doc/doc.service';
import { TEXTBOOK_EVENTS, type TextbookUploadedV1 } from './textbook.contract';

/**
 * Учебники поверх Документохранилища: загрузка учебника учителем идёт через управляемый docs/-контур
 * (doc-абстракция, S3 только там). upload-init → commit создаёт Material{fileId, disciplineId, classId}
 * и эмитит textbook.uploaded. Дальше хранилище асинхронно обогащает файл (raw→enriched) → парсер.
 *
 * Класс и дисциплина НЕ выбираются руками из всех классов школы — берутся из TeachingAssignment
 * загружающего учителя: одно назначение — автоматически; несколько — учитель выбирает СВОЁ
 * назначение (assignmentId), сервер валидирует принадлежность.
 */
@Injectable()
export class MaterialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly doc: DocService,
  ) {}

  /**
   * Резолв активного назначения учителя: assignmentId (из селектора его собственных назначений)
   * или единственное назначение автоматически. Несколько без выбора → 400 с их списком.
   */
  private async resolveAssignment(teacherId: string, assignmentId?: string) {
    const assignments = await this.prisma.teachingAssignment.findMany({
      where: { teacherId },
      include: { class: { select: { label: true } }, subject: { select: { name: true } } },
    });
    if (assignments.length === 0) {
      throw new BadRequestException({ code: 'NO_ASSIGNMENT', message: 'у учителя нет назначений (класс+дисциплина) — обратитесь к завучу' });
    }
    if (assignmentId) {
      const own = assignments.find((a) => a.id === assignmentId);
      if (!own) throw new BadRequestException({ code: 'NOT_YOUR_ASSIGNMENT', message: 'назначение не принадлежит учителю' });
      return own;
    }
    if (assignments.length === 1) return assignments[0];
    throw new BadRequestException({
      code: 'ASSIGNMENT_REQUIRED',
      message: 'несколько назначений — укажите assignmentId',
      assignments: assignments.map((a) => ({ id: a.id, classLabel: a.class.label, subject: a.subject.name })),
    });
  }

  /**
   * Инициация загрузки: pre-signed PUT в docs/ (через doc-абстракцию). Класс+дисциплина — из
   * TeachingAssignment учителя (авто при одном, assignmentId при нескольких).
   */
  async uploadInit(input: { mime: string; assignmentId?: string }, ownerId: string) {
    const a = await this.resolveAssignment(ownerId, input.assignmentId);
    // scope=школа: учебник — общий ресурс школы, не личный файл. S3 не сконфигурирован → doc отдаёт 503.
    const res = await this.doc.uploadUrl(
      { mime: input.mime, scope: 'школа', disciplineId: a.subjectId, classId: a.classId },
      ownerId,
    );
    return { ...res, classId: a.classId, disciplineId: a.subjectId };
  }

  /**
   * Подтверждение загрузки: doc.commit валидирует объект в S3 (HEAD→raw→doc.file.created), затем заводим
   * Material{disciplineId, classId из назначения} и эмитим textbook.uploaded. Идемпотентно по fileId
   * (@unique): повтор — без дубля и без события.
   */
  async commit(fileId: string, actor: string) {
    const committed = await this.doc.commit(fileId); // 409 NO_OBJECT если PUT не выполнен; 503 если S3 не готов
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException('файл не найден');
    if (!file.disciplineId) throw new BadRequestException('у файла нет disciplineId — не учебник');
    const ws = TenantContext.require();

    const existing = await this.prisma.material.findUnique({ where: { fileId } });
    const material =
      existing ??
      (await this.prisma.material.create({
        data: { workspaceId: ws, fileId, disciplineId: file.disciplineId, classId: file.classId, uploadedBy: actor },
      }));
    if (!existing) {
      await this.prisma.$transaction((tx) =>
        this.outbox.enqueue(
          tx,
          newEvent<TextbookUploadedV1>({
            type: TEXTBOOK_EVENTS.uploaded,
            workspaceId: ws,
            actor,
            payload: { materialId: material.id, disciplineId: material.disciplineId, fileId },
          }),
        ),
      );
    }
    return { materialId: material.id, fileId, disciplineId: material.disciplineId, classId: material.classId, state: committed.state };
  }
}
