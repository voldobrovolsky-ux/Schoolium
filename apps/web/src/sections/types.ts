import type { ComponentType, ReactNode } from "react";
import type { TeacherClass } from "@edustore/shared";
import type { IconName } from "@/design/Icon";

export interface ToastInput {
  type: "urgent" | "normal" | "info";
  title: string;
  msg?: string;
}

/** Контекст, который оболочка (AppShell) передаёт каждому разделу. */
export interface SectionContext {
  /** Активный «флажок» — предмет в классе. */
  assignment: TeacherClass | null;
  pushToast: (t: ToastInput) => void;
  /** Запрос из строки поиска верхней панели (используют разделы, которым нужен поиск). */
  searchQuery: string;
}

export interface SectionProps {
  ctx: SectionContext;
}

/**
 * Дескриптор раздела рабочего пространства.
 * Добавить раздел = создать папку с компонентами и одну запись в registry.ts.
 * Оболочка сама отрисует иконку, переключение, нужные зоны и анимацию.
 */
export interface SectionDescriptor {
  id: string;
  label: string;
  icon: IconName;
  /** Нужна ли зона 2 (метро-навигация). */
  hasMetro?: boolean;
  /** Опц. провайдер локального состояния раздела (общего для Nav/Work/RightTools). */
  Provider?: ComponentType<{ ctx: SectionContext; children: ReactNode }>;
  /** Зона 2 — навигация (например, метро-ветка ПП). */
  Nav?: ComponentType<SectionProps>;
  /** Зона 3 — центральный рабочий экран. */
  Work: ComponentType<SectionProps>;
  /** Зона 4 (нижний блок правого сайдбара) — инструменты/сводка раздела. */
  RightTools?: ComponentType<SectionProps>;
}
