import type { GeneratedMaterial } from '@prisma/client';
import type { LessonMaterial, MaterialType } from '@edustore/shared';

/**
 * Презентационные атрибуты материала (иконка/оттенок/аудитория) по его типу.
 * Держим в одном месте, чтобы planning и materials отдавали одинаковый вид.
 */
const PRESENTATION: Record<
  MaterialType,
  { icon: string; tint: string; audience: string }
> = {
  LESSON_PLAN: { icon: 'doc', tint: 'blue', audience: 'для учителя' },
  GRAPHIC_NOTES: { icon: 'image', tint: 'violet', audience: 'для учителя' },
  PRESENTATION: { icon: 'presentation', tint: 'amber', audience: 'для класса' },
  TEST: { icon: 'check', tint: 'green', audience: 'для класса' },
  CONTROL: { icon: 'clipboard', tint: 'red', audience: 'для класса' },
  BRIEF_TEST: { icon: 'check', tint: 'green', audience: 'для класса' },
};

/** Prisma-запись материала → контрактный LessonMaterial. */
export function toLessonMaterial(m: GeneratedMaterial): LessonMaterial {
  const p = PRESENTATION[m.type as MaterialType] ?? {
    icon: 'doc',
    tint: 'blue',
    audience: 'для учителя',
  };
  return {
    id: m.id,
    type: m.type as MaterialType,
    title: m.title,
    audience: p.audience,
    format: m.format,
    meta: m.meta ?? undefined,
    icon: p.icon,
    tint: p.tint,
    fileUrl: m.fileUrl,
  };
}
