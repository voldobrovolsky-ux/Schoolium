import { Injectable, NotFoundException } from '@nestjs/common';
import { MaterialType } from '@prisma/client';
import type { LessonMaterial } from '@edustore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { toLessonMaterial } from '../../common/materials.util';

/** Какой материал генерирует каждый эндпоинт /generate/*. */
export type GenerateKind =
  | 'lesson-plan'
  | 'presentation'
  | 'brief-test'
  | 'control-work'
  | 'exam';

const KIND_MAP: Record<
  GenerateKind,
  { type: MaterialType; title: string; format: string; meta: string }
> = {
  'lesson-plan': {
    type: MaterialType.LESSON_PLAN,
    title: 'План-конспект урока',
    format: 'DOCX',
    meta: '6 страниц',
  },
  presentation: {
    type: MaterialType.PRESENTATION,
    title: 'Презентация к уроку',
    format: 'PPTX',
    meta: '18 слайдов',
  },
  'brief-test': {
    type: MaterialType.BRIEF_TEST,
    title: 'Краткий тест',
    format: 'PDF',
    meta: '1 страница',
  },
  'control-work': {
    type: MaterialType.CONTROL,
    title: 'Контрольная работа',
    format: 'PDF',
    meta: '2 страницы',
  },
  exam: {
    type: MaterialType.CONTROL,
    title: 'Экзаменационная работа',
    format: 'PDF',
    meta: '4 страницы',
  },
};

/**
 * Домен «материалы» (скелет): выдача материалов урока и заглушки генерации.
 * Реальная генерация будет дозаполнена позже (см. ARCHITECTURE.md «скелеты»).
 */
@Injectable()
export class MaterialsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Материалы конкретного урока. */
  async listForLesson(lessonId: string): Promise<LessonMaterial[]> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { materials: { orderBy: { generatedAt: 'asc' } } },
    });
    if (!lesson) {
      throw new NotFoundException(`Урок ${lessonId} не найден`);
    }
    return lesson.materials.map(toLessonMaterial);
  }

  /** Заглушка генерации: создаёт запись GeneratedMaterial и возвращает её. */
  async generate(
    kind: GenerateKind,
    lessonId: string,
  ): Promise<LessonMaterial> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { id: true },
    });
    if (!lesson) {
      throw new NotFoundException(`Урок ${lessonId} не найден`);
    }

    const spec = KIND_MAP[kind];
    const created = await this.prisma.generatedMaterial.create({
      data: {
        workspaceId: TenantContext.require(), // тенант = школа урока (активный контекст)
        lessonId,
        type: spec.type,
        title: spec.title,
        fileUrl: `/files/stub/${kind}-${lessonId}.${spec.format.toLowerCase()}`,
        format: spec.format,
        meta: spec.meta,
      },
    });
    return toLessonMaterial(created);
  }
}
