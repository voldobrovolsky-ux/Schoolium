import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/design/Icon";
import type { SectionProps } from "@/sections/types";
import { eduApi, type BriefTestPrint, type EduLesson } from "@/lib/eduApi";
import { HttpError } from "@/lib/http";
import "./brieftest.css";

type Phase = "pick" | "printed" | "checked";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", weekday: "short" });

/**
 * Летучка (Движок §5): выбор урока → печать листов с КОДАМИ (гейт идентичности §3 — без ФИО)
 * → реальная печать (window.print) → проверка по кодам → assessment.checked → ИОМ.
 */
export function BriefTestScreen({ ctx }: SectionProps) {
  const [lessons, setLessons] = useState<EduLesson[] | null>(null);
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [bt, setBt] = useState<BriefTestPrint | null>(null);
  const [phase, setPhase] = useState<Phase>("pick");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const a = ctx.assignment;

  useEffect(() => {
    let alive = true;
    eduApi
      .scheduleMe()
      .then((ls) => alive && setLessons(ls))
      .catch(() => alive && setLessons([]));
    return () => {
      alive = false;
    };
  }, []);

  // уроки активного флажка (класс+предмет); без флажка — все мои
  const myLessons = useMemo(() => {
    const all = lessons ?? [];
    const filtered = a ? all.filter((l) => l.classId === a.classId && l.subjectId === a.subjectId) : all;
    return [...filtered].sort((x, y) => x.date.localeCompare(y.date));
  }, [lessons, a]);

  useEffect(() => {
    if (!lessonId && myLessons.length) {
      // дефолт: ближайший непроведённый, иначе последний
      const next = myLessons.find((l) => l.state !== "done") ?? myLessons[myLessons.length - 1];
      setLessonId(next.id);
    }
  }, [myLessons, lessonId]);

  const lesson = myLessons.find((l) => l.id === lessonId) ?? null;

  const reset = () => {
    setBt(null);
    setScores({});
    setPhase("pick");
    setErr("");
  };

  const generate = async () => {
    if (!lesson || busy) return;
    setBusy(true);
    setErr("");
    try {
      const res = await eduApi.printBriefTest(lesson.id);
      setBt(res);
      setPhase("printed");
      setSheetOpen(true); // сразу к печати
    } catch (e) {
      setErr(e instanceof HttpError ? e.message : "Не удалось сформировать листы");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!bt || busy) return;
    const results = Object.entries(scores).map(([studentCode, score]) => ({ studentCode, score }));
    if (!results.length) return;
    setBusy(true);
    setErr("");
    try {
      await eduApi.checkBriefTest(bt.id, results);
      setPhase("checked");
      ctx.pushToast({ type: "normal", title: "Летучка проверена", msg: `Результаты по ${results.length} кодам ушли в ИОМ` });
    } catch (e) {
      setErr(e instanceof HttpError ? e.message : "Не удалось отправить результаты");
    } finally {
      setBusy(false);
    }
  };

  const ratedCount = Object.keys(scores).length;
  const avg = ratedCount ? Object.values(scores).reduce((s, v) => s + v, 0) / ratedCount : 0;

  return (
    <div className="bt-wrap">
      {/* уроки */}
      <div className="bt-col-lessons">
        <div className="bt-card">
          <h3 className="bt-h"><Icon name="test" size={17} /> Летучка</h3>
          <div className="bt-sub">{a ? `${a.label} · ${a.subject}` : "Выберите класс в верхней панели"}</div>
        </div>
        {lessons === null && <div className="bt-empty">Загружаем уроки…</div>}
        {lessons !== null && myLessons.length === 0 && (
          <div className="bt-card bt-empty">Уроков нет — сначала утверждается КТП/КПП (завуч)</div>
        )}
        {myLessons.map((l) => (
          <button
            key={l.id}
            className={`bt-lesson${l.id === lessonId ? " is-active" : ""}`}
            onClick={() => {
              setLessonId(l.id);
              reset();
            }}
          >
            <div className="t">
              <div className="topic">{l.topic}</div>
              <div className="date">{fmtDate(l.date)}</div>
            </div>
            <span className={`bt-state ${l.state}`}>{l.state === "done" ? "проведён" : l.state === "running" ? "идёт" : "план"}</span>
          </button>
        ))}
      </div>

      {/* основной поток */}
      <div className="bt-col-main">
        <div className="bt-card">
          <div className="bt-steps">
            <Step n={1} label="Листы" on={phase === "pick"} done={phase !== "pick"} />
            <span className="bt-step-sep" />
            <Step n={2} label="Печать" on={phase === "printed" && sheetOpen} done={phase === "checked"} />
            <span className="bt-step-sep" />
            <Step n={3} label="Проверка" on={phase === "printed" && !sheetOpen} done={phase === "checked"} />
            <span className="bt-step-sep" />
            <Step n={4} label="Готово" on={phase === "checked"} done={false} />
          </div>
        </div>

        {err && <div className="bt-err">{err}</div>}

        {phase === "pick" && (
          <div className="bt-card">
            <h3 className="bt-h">Сформировать листы</h3>
            <p className="bt-sub" style={{ margin: "0 0 14px" }}>
              Каждый ученик получит лист с <b>кодом-псевдонимом</b> — без фамилий на бумаге (защита данных §3).
              Результаты вернутся в систему по кодам.
            </p>
            <div className="bt-actions">
              <button className="bt-btn" onClick={generate} disabled={!lesson || busy}>
                <Icon name="print" size={16} /> {busy ? "Формируем…" : lesson ? `Листы для урока «${trunc(lesson.topic, 28)}»` : "Выберите урок"}
              </button>
            </div>
          </div>
        )}

        {phase === "printed" && bt && (
          <div className="bt-card">
            <h3 className="bt-h">Проверка · {bt.count} листов</h3>
            <p className="bt-sub" style={{ margin: "0 0 12px" }}>
              Отметьте результат по каждому коду: <b>✗</b> — не справился, <b>½</b> — частично, <b>✓</b> — справился.
            </p>
            <div className="bt-check-grid">
              {bt.codes.map((code) => (
                <div key={code} className={`bt-code-row${scores[code] !== undefined ? " rated" : ""}`}>
                  <span className="bt-code">{code}</span>
                  <span className="bt-seg">
                    {([[0, "✗", "v0"], [0.5, "½", "v05"], [1, "✓", "v1"]] as const).map(([v, t, cls]) => (
                      <button
                        key={cls}
                        className={`${cls}${scores[code] === v ? " on" : ""}`}
                        onClick={() => setScores((s) => ({ ...s, [code]: v }))}
                        title={t}
                      >
                        {t}
                      </button>
                    ))}
                  </span>
                </div>
              ))}
            </div>
            <div className="bt-actions" style={{ marginTop: 14 }}>
              <button className="bt-btn ghost" onClick={() => setSheetOpen(true)}>
                <Icon name="print" size={16} /> Печатать ещё раз
              </button>
              <button className="bt-btn" onClick={submit} disabled={busy || ratedCount === 0}>
                <Icon name="check" size={16} /> {busy ? "Отправляем…" : `Отправить (${ratedCount}/${bt.count})`}
              </button>
            </div>
          </div>
        )}

        {phase === "checked" && (
          <div className="bt-card">
            <h3 className="bt-h"><Icon name="check" size={17} /> Летучка завершена</h3>
            <div className="bt-summary" style={{ margin: "10px 0 14px" }}>
              <span className="bt-score-big">{Math.round(avg * 100)}%</span>
              <span className="bt-sub">средний результат по {ratedCount} отмеченным кодам.<br />Сигналы ушли в ИОМ учеников.</span>
            </div>
            <div className="bt-actions">
              <button className="bt-btn ghost" onClick={reset}>Новая летучка</button>
            </div>
          </div>
        )}
      </div>

      {sheetOpen && bt && lesson && (
        <PrintSheet bt={bt} lesson={lesson} classLabel={a?.label ?? ""} subject={a?.subject ?? ""} onClose={() => setSheetOpen(false)} />
      )}
    </div>
  );
}

function Step({ n, label, on, done }: { n: number; label: string; on: boolean; done: boolean }) {
  return (
    <span className={`bt-step${on ? " is-on" : ""}${done ? " is-done" : ""}`}>
      <span className="n">{done ? "✓" : n}</span> {label}
    </span>
  );
}

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Печатный лист: на бумагу уходит ТОЛЬКО .bt-sheet (см. @media print). Кнопка зовёт window.print(). */
function PrintSheet({
  bt,
  lesson,
  classLabel,
  subject,
  onClose,
}: {
  bt: BriefTestPrint;
  lesson: EduLesson;
  classLabel: string;
  subject: string;
  onClose: () => void;
}) {
  return (
    <div className="bt-print-backdrop" onClick={onClose}>
      <div className="bt-print-frame" onClick={(e) => e.stopPropagation()}>
        <div className="bt-print-bar">
          <button className="bt-btn ghost" onClick={onClose}><Icon name="x" size={16} /> Закрыть</button>
          <button className="bt-btn" onClick={() => window.print()} data-testid="bt-print">
            <Icon name="print" size={16} /> Печать
          </button>
        </div>
        <div className="bt-sheet">
          <div className="bt-sheet-head">
            <h1>Летучка</h1>
            <span className="m">EduStore · лист ответов</span>
          </div>
          <div className="bt-sheet-meta">
            <span>Класс: <b>{classLabel || "—"}</b></span>
            <span>Предмет: <b>{subject || "—"}</b></span>
            <span>Тема: <b>{lesson.topic}</b></span>
            <span>Дата: <b>{new Date(lesson.date).toLocaleDateString("ru-RU")}</b></span>
          </div>
          <div className="bt-sheet-note">
            Разрежьте по билетам и раздайте. Ученик подписывает работу ТОЛЬКО кодом — без фамилии.
          </div>
          <div className="bt-sheet-grid">
            {bt.codes.map((code) => (
              <div key={code} className="bt-ticket">
                <div className="code">{code}</div>
                <div className="line" />
                <div className="line" />
                <div className="line" />
              </div>
            ))}
          </div>
          <div className="bt-sheet-foot">
            <span>{bt.count} билетов · коды-псевдонимы (152-ФЗ)</span>
            <span>edustore-flor-group.ru</span>
          </div>
        </div>
      </div>
    </div>
  );
}
