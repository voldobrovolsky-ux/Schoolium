import type { SectionDescriptor } from "@/sections/types";
import { MaterialsScreen } from "./MaterialsScreen";

/** Материалы: загрузка учебников (docs/-контур) + разбор парсера (темы/карты → источник КТП). */
export const materialsSection: SectionDescriptor = {
  id: "materials",
  label: "Материалы",
  icon: "materials",
  Work: MaterialsScreen,
};
