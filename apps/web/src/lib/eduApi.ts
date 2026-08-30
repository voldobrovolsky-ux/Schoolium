// Клиент образовательного движка (/api/v1/edu/*): расписание, летучка, КТП/КПП (надзор завуча).
import { http } from "./http";
import type { TimetableDto } from "@edustore/shared";

export interface EduLesson {
  id: string;
  date: string; // ISO
  topic: string;
  classId: string;
  subjectId: string;
  state: "idle" | "running" | "done" | string;
}

export interface BriefTestPrint {
  id: string;
  status: "generated";
  count: number;
  codes: string[]; // псевдонимы (гейт §3 — без ФИО)
}
export interface BriefTestCheckResult {
  id: string;
  status: "checked";
  items: number;
}

export interface KtpTopicDto {
  id: string;
  order: number;
  title: string;
  fgosHours: number;
  hoursSource: "estimated" | null; // 'estimated' — оценка парсера (ручная правка снимает)
  arCodes: string[];
}
export interface KtpDto {
  id: string;
  classId: string;
  disciplineId: string;
  status: "draft" | "approved" | string;
  approvedBy: string | null;
  topics: KtpTopicDto[];
  createdAt: string;
}
export interface KtpApproveOutcome {
  id: string;
  status: string;
  kpp: { id: string; status: string; lessonCount: number } | null;
  reason?: string | null; // код причины, если КПП не собрался (INSUFFICIENT_SLOTS/NO_TIMETABLE/…)
}
export interface KppLessonDto {
  id: string;
  sequenceNo: number;
  topic: { id: string; title: string; order: number };
}
export interface KppDto {
  id: string;
  classId: string;
  disciplineId: string;
  status: "scheduled" | "approved" | string;
  lessons: KppLessonDto[];
  createdAt: string;
}

/** Карта-содержание урока (LessonContent → TextbookCard), разложено по kpp.approved. */
export interface LessonContentDto {
  id: string;
  order: number;
  cardId: string;
  title: string;
  content: string | null;
}
export interface EduLessonDetail extends EduLesson {
  startGateOpen: boolean;
  contents: LessonContentDto[];
  kppLesson: { topic: { id: string; title: string; fgosHours: number; hoursSource: string | null } } | null;
}

const BASE = "/api/v1/edu";

export const eduApi = {
  scheduleMe: () => http<EduLesson[]>(`${BASE}/schedule/me`),
  lesson: (id: string) => http<EduLessonDetail>(`${BASE}/lessons/${id}`),

  // летучка (Движок §5): печать кодов → проверка (score 0..1 по коду)
  printBriefTest: (lessonId: string) =>
    http<BriefTestPrint>(`${BASE}/lessons/${lessonId}/brief-test/print`, { method: "POST", body: JSON.stringify({}) }),
  checkBriefTest: (briefTestId: string, results: { studentCode: string; score: number }[]) =>
    http<BriefTestCheckResult>(`${BASE}/brief-test/${briefTestId}/check`, { method: "POST", body: JSON.stringify({ results }) }),

  // КТП / КПП (надзор завуча)
  ktpList: (classId?: string, disciplineId?: string) =>
    http<KtpDto[]>(`${BASE}/ktp${qs({ classId, disciplineId })}`),
  /** Правка темы черновика (часы/название) — снимает флаг «оценка парсера». */
  updateKtpTopic: (topicId: string, patch: { title?: string; fgosHours?: number }) =>
    http<KtpTopicDto>(`${BASE}/ktp/topics/${topicId}`, { method: "POST", body: JSON.stringify(patch) }),
  approveKtp: (id: string) => http<KtpApproveOutcome>(`${BASE}/ktp/${id}/approve`, { method: "POST", body: "{}" }),
  kppList: (classId?: string, disciplineId?: string) =>
    http<KppDto[]>(`${BASE}/kpp${qs({ classId, disciplineId })}`),
  approveKpp: (id: string) => http<{ id: string; status: string }>(`${BASE}/kpp/${id}/approve`, { method: "POST", body: "{}" }),

  // Сетка расписания (AR-38): типовая неделя класса; движок — единственный писатель
  timetable: (classId?: string) => http<TimetableDto[]>(`${BASE}/timetable${qs({ classId })}`),
  saveTimetable: (classId: string, slots: { day: number; position: number; durationMin?: number }[]) =>
    http<TimetableDto>(`${BASE}/timetable`, { method: "POST", body: JSON.stringify({ classId, slots }) }),
};

export type { TimetableDto, TimetableSlotDto } from "@edustore/shared";

function qs(params: Record<string, string | undefined>): string {
  const p = Object.entries(params).filter(([, v]) => v) as [string, string][];
  return p.length ? "?" + new URLSearchParams(p).toString() : "";
}
