import {
  API_ROUTES,
  type TeacherClass,
  type TeacherProfile,
  type LessonStation,
  type LessonDetail,
  type JournalData,
  type JournalRow,
  type SetGradeRequest,
  type VoiceGradeRequest,
  type VoiceGradeResponse,
  type NotificationDto,
} from "@edustore/shared";
import { http, HttpError } from "./http";

// AR-36: единый HTTP-слой (lib/http.ts) — cookie-сессия в проде, dev-заголовки только в DEV.
// Прод-хардкод x-florus-user-id удалён. ApiError сохранён как алиас для существующих catch.
export { HttpError as ApiError };

export const api = {
  getProfile: () => http<TeacherProfile>(API_ROUTES.teacherProfile),
  getClasses: () => http<TeacherClass[]>(API_ROUTES.teacherClasses),
  getLessons: (classId: string, subjectId?: string) =>
    http<LessonStation[]>(
      API_ROUTES.lessons(classId) + (subjectId ? `?subjectId=${subjectId}` : ""),
    ),
  getLesson: (lessonId: string) => http<LessonDetail>(API_ROUTES.lesson(lessonId)),
  getJournal: (classId: string, subjectId?: string) =>
    http<JournalData>(
      API_ROUTES.journal(classId) + (subjectId ? `?subjectId=${subjectId}` : ""),
    ),
  setGrade: (body: SetGradeRequest) =>
    http<JournalRow>(API_ROUTES.grade, { method: "POST", body: JSON.stringify(body) }),
  voiceGrade: (body: VoiceGradeRequest) =>
    http<VoiceGradeResponse>(API_ROUTES.voiceGrade, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getNotifications: () => http<NotificationDto[]>(API_ROUTES.notifications),
};
