import type { IconName } from "@/design/Icon";

/** Левый сайдбар (зона 1). Расширяется добавлением записи. */
export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
}

export const NAV_SECTIONS: NavItem[] = [
  { id: "home", label: "Главная", icon: "home" },
  { id: "workspace", label: "Рабочее пространство", icon: "workspace" },
  { id: "schedule", label: "Расписание", icon: "schedule" },
  { id: "storage", label: "Хранилище", icon: "storage" },
  { id: "personalize", label: "Персонализация", icon: "personalize" },
  { id: "assistant", label: "ИИ-ассистент", icon: "bot" },
  { id: "profile", label: "Профиль", icon: "user" },
];
