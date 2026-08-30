import { useEffect, useState } from "react";
import type { GradeValue, JournalData } from "@edustore/shared";
import { studentAvg } from "@edustore/shared";
import { api } from "@/lib/api";

/** Данные журнала для мобильного экрана: загрузка + оптимистичная запись оценки. */
export function useMobileJournal(classId?: string, subjectId?: string) {
  const [data, setData] = useState<JournalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!classId) return;
    let alive = true;
    setLoading(true);
    api
      .getJournal(classId, subjectId)
      .then((d) => alive && (setData(d), setLoading(false)))
      .catch(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [classId, subjectId]);

  const latestLessonId = data?.columns.at(-1)?.lessonId ?? null;

  const setGrade = async (studentId: string, lessonId: string, value: GradeValue) => {
    const before = data; // снимок для отката
    setData((d) => patchCell(d, studentId, lessonId, value));
    setFlash(`${studentId}|${lessonId}`);
    setTimeout(() => setFlash(null), 700);
    try {
      const row = await api.setGrade({ studentId, lessonId, value });
      setData((d) => (d ? { ...d, rows: d.rows.map((r) => (r.studentId === studentId ? row : r)) } : d));
    } catch {
      // AR-40: офлайн-очереди нет — честный ОТКАТ вместо молчаливого «принято».
      // Оценка не сохранена, и пользователь обязан это увидеть (как на десктопе).
      setData(before);
      setError("Нет сети — оценка не сохранена. Повторите при подключении.");
      setTimeout(() => setError(null), 3500);
    }
  };

  return { data, loading, latestLessonId, flash, error, setGrade };
}

function patchCell(d: JournalData | null, studentId: string, lessonId: string, value: GradeValue) {
  if (!d) return d;
  const ix = d.columns.findIndex((c) => c.lessonId === lessonId);
  if (ix < 0) return d;
  return {
    ...d,
    rows: d.rows.map((r) => {
      if (r.studentId !== studentId) return r;
      const grades = r.grades.slice();
      grades[ix] = value;
      return { ...r, grades, avg: studentAvg(grades) };
    }),
  };
}
