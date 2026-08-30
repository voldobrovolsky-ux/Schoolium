import type { SectionDescriptor } from "./types";
import { journalSection } from "./journal";
import { planningSection } from "./planning";
import { brieftestSection } from "./brieftest";
import { materialsSection } from "./materials";
import { placeholderSection } from "./_placeholder/Placeholder";

/**
 * РЕЕСТР РАЗДЕЛОВ рабочего пространства — единственная точка регистрации.
 * Добавить раздел: создать папку с дескриптором и дописать его сюда. Оболочка
 * (AppShell) сама отрисует иконку, переключение, зоны и анимацию.
 */
export const SECTIONS: SectionDescriptor[] = [
  journalSection,
  planningSection,
  brieftestSection,
  materialsSection,
  placeholderSection("ktp", "КТП", "ktp"),
  placeholderSection("mm", "ММ", "mm"),
  placeholderSection("analytics", "Аналитика", "analytics"),
];

export const DEFAULT_SECTION = "pp";

export function getSection(id: string): SectionDescriptor {
  return SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];
}
