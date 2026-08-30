/**
 * `S-90` дневник и `S-91` успеваемость (AR-158, AR-159) — кабинет ученика и
 * родителя. Чтение без единой мутации; объём решает сервер по идентичности
 * (свои дети / сам ученик), экран ничего не фильтрует сам.
 *
 * Раскладка — школьный дневник: дни недели → уроки → предмет, тема, отметка.
 * Колонки ДЗ нет вовсе — появится инкрементом №2, пустая колонка не рисуется.
 */
import { useEffect, useState } from "react";
import { slotTimes, type DiaryChildDto, type DiaryWeekDto, type SubjectAverageDto } from "@edustore/shared";
import { api, SchoolApiError } from "../api";
import { useAsync } from "../hooks";
import { Badge, Button, EmptyState, ErrorState, MarkChip, Skeletons } from "../ui";
import { navigate } from "../router";

const DAY_NAMES = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const dayName = (isoDay: string): string => DAY_NAMES[(new Date(`${isoDay}T00:00:00.000Z`).getUTCDay() + 6) % 7];
const fmtDay = (isoDay: string): string => {
  const [, m, d] = isoDay.split("-");
  return `${d}.${m}`;
};

export function DiaryScreen() {
  const [children, setChildren] = useState<DiaryChildDto[] | null>(null);
  const [child, setChild] = useState<string | null>(null);
  const [week, setWeek] = useState<string | null>(null);
  const [data, setData] = useState<DiaryWeekDto | null>(null);
  const [averages, setAverages] = useState<SubjectAverageDto[] | null>(null);
  const [tab, setTab] = useState<"week" | "averages">("week");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .diaryChildren()
      .then((c) => {
        setChildren(c);
        if (c.length > 0) setChild(c[0].studentId);
      })
      .catch((e) => setError(e instanceof SchoolApiError ? e.message : "Не удалось открыть дневник"));
  }, []);

  useEffect(() => {
    if (!child) return;
    setData(null);
    api
      .diaryWeek(child, week)
      .then(setData)
      .catch((e) => setError(e instanceof SchoolApiError ? e.message : "Не удалось открыть дневник"));
    api
      .diaryAverages(child)
      .then(setAverages)
      .catch(() => undefined);
  }, [child, week]);

  return (
    <div className="sch" style={{ maxWidth: 720, margin: "0 auto", padding: "var(--sp-16)" }}>
      <div className="sch-page-head">
        <h1 data-testid="S-90.header">Дневник</h1>
        <Button
          kind="ghost"
          testId="S-90.btn.logout"
          onClick={async () => {
            await api.logout().catch(() => undefined);
            navigate("/");
            window.location.reload();
          }}
        >
          Выйти
        </Button>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      ) : children === null ? (
        <Skeletons count={4} />
      ) : children.length === 0 ? (
        <EmptyState
          testId="S-90.empty"
          title="Дневников пока нет"
          hint="Записи появятся, когда модератор школы привяжет к вашей учётке ученика"
        />
      ) : (
        <>
          {/* Плитки детей — главная родителя; у ученика ровно одна и не рисуется. */}
          {children.length > 1 ? (
            <div className="sch-chips" data-testid="S-90.children" style={{ marginBottom: "var(--sp-16)" }}>
              {children.map((c) => (
                <button
                  key={c.studentId}
                  className={c.studentId === child ? "sch-chip sch-chip--active" : "sch-chip"}
                  onClick={() => {
                    setChild(c.studentId);
                    setWeek(null);
                  }}
                >
                  {c.name} · {c.classLabel}
                </button>
              ))}
            </div>
          ) : null}

          <div className="sch-chips" style={{ marginBottom: "var(--sp-16)" }}>
            <button className={tab === "week" ? "sch-chip sch-chip--active" : "sch-chip"} data-testid="S-90.tab.week" onClick={() => setTab("week")}>
              Неделя
            </button>
            <button
              className={tab === "averages" ? "sch-chip sch-chip--active" : "sch-chip"}
              data-testid="S-91.tab.averages"
              onClick={() => setTab("averages")}
            >
              Успеваемость
            </button>
          </div>

          {tab === "week" ? (
            data === null ? (
              <Skeletons count={5} />
            ) : (
              <WeekView data={data} onWeek={setWeek} />
            )
          ) : averages === null ? (
            <Skeletons count={5} />
          ) : (
            <AveragesView rows={averages} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Раскладка — лента дней + уроки выбранного дня (правка владельца 2026-08-30,
 * по референсам): чипы дней недели со стрелками недель по краям, выбранный
 * день заполнен фирменным цветом, уроки — карточками с номером слева.
 */
const DAY_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const dayShort = (isoDay: string): string => DAY_SHORT[(new Date(`${isoDay}T00:00:00.000Z`).getUTCDay() + 6) % 7];
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const dayMonth = (isoDay: string): string => `${Number(isoDay.slice(8))} ${MONTHS[Number(isoDay.slice(5, 7)) - 1]}`;

/** «1 — 5 сентября» либо «29 сентября — 3 октября» — индикатор недели. */
export const weekRange = (from: string, to: string): string =>
  from.slice(5, 7) === to.slice(5, 7) ? `${Number(from.slice(8))} — ${dayMonth(to)}` : `${dayMonth(from)} — ${dayMonth(to)}`;

function WeekView({ data, onWeek }: { data: DiaryWeekDto; onWeek: (m: string) => void }) {
  const idx = data.weeks.findIndex((w) => w.monday === data.monday);
  const prev = idx > 0 ? data.weeks[idx - 1] : null;
  const next = idx >= 0 && idx < data.weeks.length - 1 ? data.weeks[idx + 1] : null;
  const todayIso = new Date().toISOString().slice(0, 10);
  const [selected, setSelected] = useState<string | null>(null);
  const day = data.days.find((d) => d.date === selected) ?? data.days.find((d) => d.date === todayIso) ?? data.days[0] ?? null;
  const first = data.days[0]?.date ?? data.monday;
  const last = data.days[data.days.length - 1]?.date ?? data.monday;

  return (
    <div className="sch-stack" data-testid="S-90.week">
      {data.days.length === 0 ? (
        <EmptyState testId="S-90.emptyWeek" title="Уроков на этой неделе нет" />
      ) : (
        <>
          <div className="sch-weekbar">
            <button
              className="sch-weeknav"
              data-testid="S-90.btn.prevWeek"
              disabled={!prev}
              aria-label="Предыдущая неделя"
              onClick={() => prev && onWeek(prev.monday)}
            >
              ‹
            </button>
            <span className="sch-weekrange" data-testid="S-90.weekRange">
              {weekRange(first, last)}
            </span>
            <button
              className="sch-weeknav"
              data-testid="S-90.btn.nextWeek"
              disabled={!next}
              aria-label="Следующая неделя"
              onClick={() => next && onWeek(next.monday)}
            >
              ›
            </button>
          </div>

          <div className="sch-daystrip" data-testid="S-90.daystrip">
            {data.days.map((d) => (
              <button
                key={d.date}
                className={day?.date === d.date ? "sch-daychip sch-daychip--active" : "sch-daychip"}
                onClick={() => setSelected(d.date)}
              >
                <small>{dayShort(d.date)}</small>
                <span>{Number(d.date.slice(8))}</span>
              </button>
            ))}
          </div>

          {day ? (
            <section className="sch-stack" data-testid="S-90.day" aria-label={`${dayName(day.date)} ${fmtDay(day.date)}`}>
              {day.lessons.map((l, i) => {
                const t = data.grid ? slotTimes(data.grid, l.slotNo) : null;
                const nextLesson = day.lessons[i + 1];
                return (
                  <div key={l.lessonId} className="sch-stack" style={{ gap: 0 }}>
                    <div className="sch-lesson">
                      {t ? (
                        <div className="sch-lesson-time">
                          <b>{t.start}</b>
                          <span>{t.end}</span>
                        </div>
                      ) : (
                        <div className="sch-lesson-no">{l.slotNo}</div>
                      )}
                      <div className="sch-lesson-body">
                        <b>{l.subjectName}</b>
                        {l.topic ? <span>{l.topic}</span> : null}
                      </div>
                      {l.mark ? <MarkChip value={l.mark} /> : null}
                    </div>
                    {t && nextLesson ? (
                      <div className="sch-break">
                        {nextLesson.slotNo === l.slotNo + 1
                          ? `перемена ${t.breakAfterMin} мин`
                          : "окно"}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

/** `S-91` (AR-159): средние по предметам; рейтинг-ранжирование — отдельная спека. */
function AveragesView({ rows }: { rows: SubjectAverageDto[] }) {
  if (rows.length === 0) {
    return <EmptyState testId="S-91.empty" title="Предметов пока нет" hint="Успеваемость появится вместе с расписанием" />;
  }
  return (
    <div className="sch-card" data-testid="S-91.table">
      <table className="sch-table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Предмет</th>
            <th style={{ textAlign: "right" }}>Средний балл</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.subjectId}>
              <td>{r.subjectName}</td>
              <td style={{ textAlign: "right" }}>
                {/* числовых отметок нет — «—», а не ноль (AR-79, свойство P7) */}
                {r.average === null ? <span className="sch-muted">—</span> : <Badge>{r.average.toFixed(2)}</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
