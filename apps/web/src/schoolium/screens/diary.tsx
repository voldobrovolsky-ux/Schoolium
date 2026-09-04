/**
 * `S-90` дневник и `S-91` успеваемость (AR-158, AR-159) — кабинет ученика и
 * родителя. Чтение без единой мутации; объём решает сервер по идентичности
 * (свои дети / сам ученик), экран ничего не фильтрует сам.
 *
 * Раскладка — школьный дневник: дни недели → уроки → предмет, тема, отметка.
 * Колонки ДЗ нет вовсе — появится инкрементом №2, пустая колонка не рисуется.
 */
import { useEffect, useState } from "react";
import { type DiaryChildDto, type DiaryWeekDto, type SubjectAverageDto } from "@edustore/shared";
import { api, SchoolApiError } from "../api";
import { useIsMobile } from "../hooks";
import { Icon } from "../icons";
import { Badge, Button, EmptyState, ErrorState, Skeletons } from "../ui";
import { navigate } from "../router";
// Маркеры отмены/замены строки урока (AR-207) — общий вид с `S-40`, стили там же.
import "./schedule.css";
import {
  addDays,
  buildDayRows,
  DAY_NAMES,
  DayLessonList,
  DayPicker,
  Days33,
  dayMonth,
  dayNoOf,
  mondayOf,
  weekRange,
  WeekStrip,
  type DayCell,
  type PickerDay,
} from "../schedule-view";

const DAY_FULL = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

export function DiaryScreen() {
  const [children, setChildren] = useState<DiaryChildDto[] | null>(null);
  const [child, setChild] = useState<string | null>(null);
  const [week, setWeek] = useState<string | null>(null);
  // Выбранный ДЕНЬ живёт здесь, а не в WeekView: лента пикера переезжает
  // через границу недели, и перезагрузка недели не должна сбрасывать день.
  const [selDate, setSelDate] = useState<string | null>(null);
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
    // прежние данные не сбрасываются: лента пикера остаётся смонтированной,
    // пока грузится соседняя неделя (день показывает скелетон, не прыжок)
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
    // 1080, не 720: десктопная неделя 3+3 (AR-175) в двух колонках карточек
    <div className="sch" style={{ maxWidth: 1080, margin: "0 auto", padding: "var(--sp-16)" }}>
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
          icon="journal"
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
                    setSelDate(null);
                    setData(null); // другой ученик — чужая неделя не показывается
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
              <WeekView
                data={data}
                selected={selDate}
                onPick={(date) => {
                  setSelDate(date);
                  const m = mondayOf(date);
                  if (m !== data.monday) setWeek(m);
                }}
              />
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
 * Неделя дневника (AR-175, УТЦ v1.4 фаза II) — тем же общим модулем, что
 * расписание `S-40`: строка «N. Предмет» несёт отметку СРАЗУ после названия,
 * времена — из скелета дня (AR-171), без скелета — `slotTimes`. Мобайл —
 * пикер дня (правка владельца 2026-08-31): слот неподвижен, лента учебных
 * недель журнала едет под ним, переезд через границу недели догружает её;
 * десктоп — лента недель и неделя 3+3.
 */
function WeekView({
  data,
  selected,
  onPick,
}: {
  data: DiaryWeekDto;
  selected: string | null;
  onPick: (date: string) => void;
}) {
  const mobile = useIsMobile();
  const todayIso = new Date().toISOString().slice(0, 10);

  const cellsForDate = (date: string): Map<number, DayCell[]> => {
    const map = new Map<number, DayCell[]>();
    for (const l of data.days.find((d) => d.date === date)?.lessons ?? []) {
      const cells = map.get(l.slotNo) ?? [];
      cells.push({
        key: l.lessonId,
        title: l.subjectName,
        sub: l.topic,
        mark: l.mark,
        lessonId: l.lessonId,
        // AR-207: ученику и родителю — только факт: «Урок отменён» / «Замена:
        // Фамилия И.»; причина отмены сюда не приходит и не показывается.
        status: l.cancelled
          ? { kind: "cancelled", label: "Урок отменён" }
          : l.substituteName
            ? { kind: "substituted", label: `Замена: ${l.substituteName}` }
            : null,
      });
      map.set(l.slotNo, cells);
    }
    return map;
  };
  const rowsForDate = (date: string) =>
    buildDayRows({
      skeleton: data.skeleton,
      grid: data.grid,
      dayNo: dayNoOf(date),
      cellsByLesson: cellsForDate(date),
      // обед класса ученика (AR-200): строка «Обед» после урока N вместо общего meal
      lunchAfterLessonNo: data.lunchAfterLessonNo ?? null,
    });
  const rowsFor = (dayNo: number) => rowsForDate(addDays(data.monday, dayNo));

  // Лента пикера — учебные дни всех недель журнала; пустоту знаем только у
  // загруженной недели, о чужих не врём приглушением.
  const pickerDays: PickerDay[] = data.weeks.flatMap((w) =>
    [0, 1, 2, 3, 4, 5].map((d) => ({
      date: addDays(w.monday, d),
      dayNo: d,
      muted: w.monday === data.monday ? rowsFor(d).length === 0 : false,
    })),
  );

  const open =
    selected && pickerDays.some((d) => d.date === selected)
      ? selected
      : (pickerDays.find((d) => d.date >= todayIso)?.date ?? pickerDays[pickerDays.length - 1]?.date ?? data.monday);
  // День из соседней недели уже выбран, а её данные ещё едут — скелетон дня.
  const loadingWeek = mondayOf(open) !== data.monday;
  // Стрелки недель ходят от недели ОТКРЫТОГО дня — она может отличаться от загруженной.
  const openIdx = data.weeks.findIndex((w) => w.monday === mondayOf(open));
  const prev = openIdx > 0 ? data.weeks[openIdx - 1] : null;
  const next = openIdx >= 0 && openIdx < data.weeks.length - 1 ? data.weeks[openIdx + 1] : null;

  return (
    <div className="sch-stack" data-testid="S-90.week">
      {data.weeks.length === 0 && data.days.length === 0 ? (
        <EmptyState icon="journal" testId="S-90.emptyWeek" title="Уроков на этой неделе нет" />
      ) : mobile ? (
        <>
          <div className="sch-weekbar">
            <button
              className="sch-weeknav"
              data-testid="S-90.btn.prevWeek"
              disabled={!prev}
              aria-label="Предыдущая неделя"
              onClick={() => prev && onPick(addDays(prev.monday, dayNoOf(open)))}
            >
              <Icon name="chevronLeft" />
            </button>
            <span className="sch-weekrange" data-testid="S-90.weekRange">
              {weekRange(mondayOf(open), addDays(mondayOf(open), 5))}
            </span>
            <button
              className="sch-weeknav"
              data-testid="S-90.btn.nextWeek"
              disabled={!next}
              aria-label="Следующая неделя"
              onClick={() => next && onPick(addDays(next.monday, dayNoOf(open)))}
            >
              <Icon name="chevronRight" />
            </button>
          </div>

          <DayPicker testId="S-90.daystrip" days={pickerDays} open={open} onOpen={onPick} />

          <section aria-label={`${DAY_FULL[dayNoOf(open)]} ${dayMonth(open)}`}>
            {/* key: смена дня перезапускает раскрытие сверху вниз (`sch-unfold`) */}
            {loadingWeek ? (
              <Skeletons count={3} />
            ) : (
              <DayLessonList key={open} rows={rowsForDate(open)} testId="S-90.day" />
            )}
          </section>
        </>
      ) : (
        <>
          {/* десктоп: недели журнала лентой (`S-90.weekRange` живёт в ленте недель) */}
          <WeekStrip
            testId="S-90.weeks"
            weeks={data.weeks.map((w) => ({
              monday: w.monday,
              label: weekRange(w.monday, addDays(w.monday, 5)),
              muted: !w.hasLessons,
            }))}
            open={data.monday}
            onOpen={onPick}
          />
          <Days33
            testId="S-90.day"
            dayNos={[0, 1, 2, 3, 4, 5]}
            header={(d) => `${DAY_NAMES[d]} · ${dayMonth(addDays(data.monday, d))}`}
            render={(d) => <DayLessonList rows={rowsFor(d)} />}
          />
        </>
      )}
    </div>
  );
}

/** `S-91` (AR-159): средние по предметам; рейтинг-ранжирование — отдельная спека. */
function AveragesView({ rows }: { rows: SubjectAverageDto[] }) {
  if (rows.length === 0) {
    return <EmptyState icon="journal" testId="S-91.empty" title="Предметов пока нет" hint="Успеваемость появится вместе с расписанием" />;
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
