import type { ComponentType } from "react";
import type { IconName } from "./ds/Icon";
import { StructureScreen } from "@/structure/StructureScreen";
import { DevicesScreen } from "./screens/devices";
import { ParserSettingsScreen } from "./screens/parser-settings";

export interface AdminSubsection {
  id: string;
  label: string;
  Screen: ComponentType;
}
export interface AdminSection {
  id: string;
  label: string;
  icon: IconName;
  gradient: [string, string];
  subsections: AdminSubsection[];
}

/**
 * РЕЕСТР панели управления школой — единственная точка регистрации.
 * Только реальные, рабочие экраны (никаких мок-данных). Новый раздел = одна запись здесь
 * + экран на настоящих данных из API.
 */
export const ADMIN_SECTIONS: AdminSection[] = [
  {
    id: "school", label: "Школа", icon: "building-2", gradient: ["#2563EB", "#5B8DEF"],
    subsections: [
      { id: "structure", label: "Классы и подгруппы", Screen: StructureScreen },
      { id: "devices", label: "Сеть устройств", Screen: DevicesScreen },
      { id: "parser", label: "Парсер учебников", Screen: ParserSettingsScreen },
    ],
  },
];
