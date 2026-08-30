// Клиент структуры школы (классы/подгруппы/дисциплины/распределение).
// AR-36: единый HTTP-слой (lib/http.ts) + контракты из @edustore/shared (единый источник).
import { http } from "./http";
import type { StClass, StSubGroup, StSubject, StTeacher, StDevice } from "@edustore/shared";
export type { StClass, StSubGroup, StSubject, StAssignment, StTeacher, StDevice } from "@edustore/shared";


export const structureApi = {
  classes: () => http<StClass[]>("/api/structure/classes"),
  createClass: (parallel: number, letter: string) =>
    http<StClass>("/api/structure/classes", { method: "POST", body: JSON.stringify({ parallel, letter }) }),
  deleteClass: (id: string) => http<void>(`/api/structure/classes/${id}`, { method: "DELETE" }),
  addSubGroup: (classId: string, name: string) =>
    http<StSubGroup>(`/api/structure/classes/${classId}/subgroups`, { method: "POST", body: JSON.stringify({ name }) }),
  deleteSubGroup: (id: string) => http<void>(`/api/structure/subgroups/${id}`, { method: "DELETE" }),

  subjects: () => http<StSubject[]>("/api/structure/subjects"),
  createSubject: (name: string, color: string) =>
    http<StSubject>("/api/structure/subjects", { method: "POST", body: JSON.stringify({ name, color }) }),
  deleteSubject: (id: string) => http<void>(`/api/structure/subjects/${id}`, { method: "DELETE" }),

  teachers: () => http<StTeacher[]>("/api/structure/teachers"),
  assign: (b: { teacherId: string; classId: string; subjectId: string; subGroupId?: string | null }) =>
    http<{ id: string }>("/api/structure/assignments", { method: "POST", body: JSON.stringify(b) }),
  unassign: (id: string) => http<void>(`/api/structure/assignments/${id}`, { method: "DELETE" }),

  devices: () => http<StDevice[]>("/api/structure/devices"),
  deleteDevice: (id: string) => http<void>(`/api/structure/devices/${id}`, { method: "DELETE" }),
};
