/**
 * EduStore — канонический контракт фронт↔бэк (кабинет учителя).
 * Чистые типы + лёгкие хелперы без зависимостей. Импортируется как `@edustore/shared`.
 */

// ─────────────────────────── enums ───────────────────────────
export type LessonType = "LESSON" | "TEST" | "CONTROL";
export type GradeSource = "MANUAL" | "VOICE";
export type NotificationType = "URGENT" | "NORMAL" | "INFO";
export type MaterialType =
  | "LESSON_PLAN"
  | "GRAPHIC_NOTES"
  | "PRESENTATION"
  | "TEST"
  | "CONTROL"
  | "BRIEF_TEST";

/** Значение ячейки журнала: "5".."2" | "н" (отсутствие) | "" (пусто). */
export type GradeValue = "5" | "4" | "3" | "2" | "н" | "";

// ─────────────────────────── teacher / classes ───────────────────────────
/** «Флажок» верхней панели: предмет в классе. */
export interface TeacherClass {
  id: string; // assignmentId
  classId: string;
  label: string; // "8А"
  subject: string; // "Алгебра"
  subjectId: string;
  students: number;
}

export interface TeacherProfile {
  id: string; // florus_user_id
  displayName: string;
  role: string; // "учитель математики"
  initials: string;
  isCurator: boolean;
}

// ─────────────────────────── planning / metro ───────────────────────────
export interface LessonStation {
  id: string;
  type: LessonType;
  title: string;
  short: string;
  unit?: string;
  lessonNumber: number;
  date: string; // ISO
}

export interface LessonMetrics {
  progress: number; // %
  attendance: number; // %
  performance: number; // %
  submitted: number;
  total: number;
}

export interface LessonMaterial {
  id: string;
  type: MaterialType;
  title: string;
  audience: string; // "для учителя"
  format: string; // DOCX | PDF | PPTX
  meta?: string; // "6 страниц"
  icon: string;
  tint: string;
  fileUrl: string;
}

export interface LessonDetail extends LessonStation {
  goals: string[];
  metrics: LessonMetrics;
  pageStart?: number;
  pageEnd?: number;
  homework?: string;
  materials: LessonMaterial[];
}

// ─────────────────────────── journal ───────────────────────────
export interface JournalColumn {
  lessonId: string;
  day: string; // "27.09"
  wd: string; // "пт"
}

export interface JournalRow {
  studentId: string;
  number: number;
  name: string;
  /** значения по колонкам (индекс соответствует columns[]) */
  grades: GradeValue[];
  avg: string; // "4.2" | "—"
}

export interface JournalSummary {
  avg: string;
  attendance: number;
  count: number;
}

export interface JournalData {
  classLabel: string;
  subject: string;
  columns: JournalColumn[];
  rows: JournalRow[];
  summary: JournalSummary;
}

export interface SetGradeRequest {
  studentId: string;
  lessonId: string;
  value: GradeValue;
  comment?: string;
  source?: GradeSource;
}

// ─────────────────────────── voice ───────────────────────────
export interface VoiceGradeRequest {
  audio: string; // base64
  classId: string;
  lessonId: string;
}

export interface VoiceCandidate {
  studentId: string;
  name: string;
  sub: string; // "9В · в журнале"
}

/** Если candidates.length > 1 — нужна дизамбигуация однофамильцев. */
export interface VoiceGradeResponse {
  transcript: string;
  grade: GradeValue;
  confidence: number;
  candidates: VoiceCandidate[];
}

// ─────────────────────────── notes / notifications ───────────────────────────
export interface TeacherNoteRequest {
  audio?: string;
  text?: string;
  lessonId?: string;
  studentIds?: string[];
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  category: string;
  title: string;
  message: string;
  time: string;
  icon: string;
}

// ─────────────────────────── helpers ───────────────────────────
/** CSS-класс ячейки журнала по значению. Совпадает с дизайн-системой. */
export function gradeClass(g: GradeValue | string): string {
  if (g === "5" || g === "4") return "g-good";
  if (g === "3") return "g-mid";
  if (g === "2") return "g-bad";
  if (g === "н") return "g-absent";
  return "";
}

export function studentAvg(grades: GradeValue[]): string {
  let sum = 0;
  let cnt = 0;
  for (const g of grades) {
    if (g && g !== "н") {
      sum += Number(g);
      cnt++;
    }
  }
  return cnt ? (sum / cnt).toFixed(1) : "—";
}

export const API_ROUTES = {
  teacherClasses: "/api/teacher/classes",
  teacherProfile: "/api/teacher/profile",
  lessons: (classId: string) => `/api/teacher/lessons/${classId}`,
  lesson: (lessonId: string) => `/api/teacher/lesson/${lessonId}`,
  journal: (classId: string) => `/api/journal/${classId}`,
  grade: "/api/journal/grade",
  voiceGrade: "/api/voice/grade",
  notes: "/api/teacher/notes",
  notifications: "/api/notifications",
} as const;

// ─────────────────────────── структура школы (AR-36: единый источник фронт↔бэк) ───────────────────────────
export interface StSubGroup { id: string; name: string }
export interface StClass { id: string; label: string; parallel: number; letter: string; students: number; subGroups: StSubGroup[] }
export interface StSubject { id: string; name: string; color: string }
export interface StAssignment { id: string; classId: string; classLabel: string; subjectId: string; subjectName: string; subGroupId: string | null }
export interface StTeacher { id: string; name: string; assignments: StAssignment[] }
export interface StDevice { id: string; name: string; boundBy: string | null; boundAt: string }

// ─────────────────────────── сетка расписания (AR-38) ───────────────────────────
export interface TimetableSlotDto { id: string; day: number; position: number; durationMin: number }
export interface TimetableDto { id: string; classId: string; source: string; slots: TimetableSlotDto[] }

// ─────────────────────────── Schoolium 1.1.1 (AR-36) ───────────────────────────
// Роли, права, шкала отметок, коды ошибок и формы всех запросов версии.
export * from "./schoolium";

// ─────────────────────── Блок «Расписание» УТЦ (AR-118…AR-127) ───────────────────────
// Маркеры качества, инварианты, ходы корректировки и контур выдачи наружу.
export * from "./schedule-quality";

// Реестр параметров расписания — один источник для экранов и генератора (AR-131).
export * from "./schedule-parameters";
