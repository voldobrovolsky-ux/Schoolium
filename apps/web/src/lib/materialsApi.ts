// Клиент учебников: загрузка через Документохранилище (upload-init → PUT presigned → commit)
// и разбор парсера (темы/карты). Контур docs/ — S3-абстракция бэка; фронт видит только presigned URL.
import { http, HttpError } from "./http";

export interface UploadInitResp {
  fileId: string;
  uploadUrl: string;
  expiresIn: number;
  classId: string;
  disciplineId: string;
}
export interface CommitResp {
  materialId: string;
  fileId: string;
  disciplineId: string;
  classId: string | null;
  state: string;
}
/** Назначение учителя (его собственный «флажок» класс+дисциплина) — контекст загрузки. */
export interface MyAssignmentDto {
  id: string; // assignmentId
  classId: string;
  label: string; // «6А»
  subject: string; // «Математика»
  subjectId: string;
}
export interface ParsedTopicDto {
  id: string;
  order: number;
  title: string;
}
export interface ParsedCardDto {
  id: string;
  order: number;
  title: string;
  content: string | null;
  topicId: string | null;
}
export interface ParsedResp {
  materialId: string | null;
  fileId: string;
  topics: ParsedTopicDto[];
  cards: ParsedCardDto[];
}
export interface DocFileDto {
  id: string;
  mime: string | null;
  state: "pending" | "raw" | "enriched" | string;
  disciplineId: string | null;
  createdAt: string;
  s3Key: string;
}

const EDU = "/api/v1/edu/materials";
const DOC = "/api/v1/doc";

export const materialsApi = {
  /** Собственные назначения учителя — контекст загрузки (класс+дисциплина берутся из них). */
  myAssignments: () => http<MyAssignmentDto[]>("/api/teacher/classes"),

  /** Класс+дисциплина НЕ передаются: сервер берёт их из назначения учителя (assignmentId — если их несколько). */
  uploadInit: (mime: string, assignmentId?: string) =>
    http<UploadInitResp>(`${EDU}/upload-init`, { method: "POST", body: JSON.stringify({ mime, assignmentId }) }),

  /**
   * PUT файла напрямую в S3 по presigned URL, с прогрессом (XHR — fetch не отдаёт onprogress).
   * ВАЖНО: content-type ДОЛЖЕН совпадать с mime из uploadInit — он входит в подпись presign.
   */
  putFile: (uploadUrl: string, file: File, mime: string, onProgress: (pct: number) => void) =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("content-type", mime);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new HttpError(xhr.status, `S3 PUT: ${xhr.statusText || xhr.status}`));
      xhr.onerror = () => reject(new HttpError(0, "S3 недоступен (сеть/CORS)"));
      xhr.send(file);
    }),

  commit: (fileId: string) => http<CommitResp>(`${EDU}/${fileId}/commit`, { method: "POST", body: "{}" }),
  parsed: (fileId: string) => http<ParsedResp>(`${EDU}/${fileId}/parsed`),

  /** Учебники дисциплины = doc-файлы с этим disciplineId (list Документохранилища). */
  listByDiscipline: (disciplineId: string) =>
    http<DocFileDto[]>(`${DOC}/files?disciplineId=${encodeURIComponent(disciplineId)}`),
};
