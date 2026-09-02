/**
 * `S-61` · кабинет завуча (AR-186, AR-193).
 *
 * Кабинет ЧИТАЕТ готовность школы и не двигает FSM: каждый пункт чек-листа
 * выведен сервером из данных (`GET /api/v1/deputy`), а не хранится галочкой,
 * поэтому здесь нет ни одной мутации — только переходы туда, где пункт
 * закрывается. Единственное действие завуча — нормы часов (AR-174) — живёт
 * на `S-40` (`M-22`); отсюда к нему ведёт primary-кнопка.
 *
 * Два чек-листа — два контура школы: УТЦ (учебный цикл: четверти, нормы,
 * скелет, сетка, журнал) и КПЦ (люди: классы, ученики, персонал, родители).
 * Большинство пунктов закрывает модератор; кабинет показывает владельца
 * каждого пункта, чтобы завуч знал, кого просить, а не искал сам.
 */
import type { ChecklistItemDto, SchoolState } from "@edustore/shared";
import { api } from "../api";
import { useAsync } from "../hooks";
import { Badge, Button, EmptyState, ErrorState, Stat, StatGrid } from "../ui";
import { Icon } from "../icons";
import { useMe, useSession } from "../session";
import { navigate } from "../router";
import "./deputy.css";

// ─────────────────────────── словари ───────────────────────────

/**
 * Состояние FSM словами (AR-72): код состояния — контракт, а не подпись.
 * Бейдж в шапке читает завуч, и «students_filled» ему ни о чём не говорит.
 */
const STATE_LABELS: Record<SchoolState, string> = {
  empty: "школа пустая",
  classes_created: "классы созданы",
  students_filled: "профили заполнены",
  subjects_created: "предметы созданы",
  staff_activated: "персонал активирован",
  teachers_bound: "педагоги привязаны",
  terms_set: "четверти заданы",
  load_set: "нормы заданы",
  priorities_set: "приоритеты заданы",
  day_params_set: "параметры дня заданы",
  generated: "сетка собрана",
  stale: "сетка устарела",
  ready: "школа ведёт журнал",
};

/** Владелец пункта по матрице ролей (AR-152, AR-174) — кто его закрывает. */
const OWNER_LABELS: Record<ChecklistItemDto["owner"], string> = {
  moderator: "модератор",
  deputy: "завуч",
  admin: "администратор",
  teacher: "педагог",
};

/**
 * Дата сервера — `YYYY-MM-DD` без времени. `new Date("2026-09-02")` даёт
 * полночь UTC, и к западу от Гринвича она печатается как вчера; поэтому
 * разбор по частям, в местном времени.
 */
function formatToday(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

// ─────────────────────────── экран ───────────────────────────

/**
 * Гейт стоит снаружи загрузки намеренно: хук `useAsync` безусловен, и роль без
 * права иначе получала бы 403 от сервера ещё до того, как увидит причину.
 */
export function DeputyScreen() {
  const { can } = useSession();
  const me = useMe();

  if (!can("school.oversee")) {
    return (
      <EmptyState
        testId="S-61.forbidden"
        title="Раздел доступен завучу и администратору"
        hint="Сводка готовности школы и нормы часов — за заместителем по учебной работе. Ваш раздел открыт по кнопке."
        action={
          <Button kind="primary" onClick={() => navigate(me.startScreen)}>
            К своему разделу
          </Button>
        }
      />
    );
  }

  return <DeputyCabinet />;
}

function DeputyCabinet() {
  const { can } = useSession();
  const [state, reload] = useAsync(() => api.deputyCabinet());

  if (state.status === "loading") return <DeputySkeleton />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;

  const d = state.data;
  const coverageDone = d.coverage.total > 0 && d.coverage.covered === d.coverage.total;
  const loadDone = d.load.total > 0 && d.load.set === d.load.total;

  return (
    <>
      <div className="sch-page-head sch-dep-head" data-testid="S-61.head">
        <h1>Кабинет завуча</h1>
        <div className="sch-dep-head-meta">
          <Badge tone={d.state === "ready" ? "success" : d.state === "stale" ? "warning" : "muted"}>{STATE_LABELS[d.state]}</Badge>
          <span className="sch-muted">{formatToday(d.today)}</span>
        </div>
      </div>

      <StatGrid testId="S-61.stats">
        <Stat value={`${d.coverage.covered} из ${d.coverage.total}`} label="покрытие предметов" tone={coverageDone ? "success" : undefined} />
        <Stat value={`${d.load.set} из ${d.load.total}`} label="нормы часов" tone={loadDone ? "success" : undefined} />
        <Stat value={d.lessonsToday} label="уроков сегодня" />
      </StatGrid>

      <div className="sch-dep-cols">
        <Checklist testId="S-61.utc" title="УТЦ — учебный цикл" items={d.utc} />
        <Checklist testId="S-61.kpc" title="КПЦ — люди школы" items={d.kpc} />
      </div>

      <div className="sch-actions sch-actions--start sch-dep-actions">
        {/* Нормы часов — единственная мутация завуча (AR-174); сама форма `M-22` живёт на `S-40`. */}
        {can("schedule.load.write") ? (
          <Button kind="primary" testId="S-61.btn.schedule" onClick={() => navigate("/schedule")}>
            Нормы часов
          </Button>
        ) : null}
        <Button kind="secondary" testId="S-61.btn.journal" onClick={() => navigate("/journal")}>
          Журналы школы
        </Button>
      </div>

      <p className="sch-muted sch-dep-foot">
        Здесь завуч видит готовность школы к учебному году и задаёт нормы часов. Классы, предметы, персонал и сетку
        ведёт модератор — у каждого пункта подписано, кто его закрывает.
      </p>
    </>
  );
}

// ─────────────────────────── чек-лист ───────────────────────────

function Checklist({ testId, title, items }: { testId: string; title: string; items: ChecklistItemDto[] }) {
  const done = items.filter((x) => x.done).length;
  return (
    <section className="sch-card sch-dep-list" data-testid={testId}>
      <div className="sch-dep-list-head">
        <h2 className="sch-section-title">{title}</h2>
        <span className="sch-muted">
          Сделано {done} из {items.length}
        </span>
      </div>
      <ul className="sch-dep-items">
        {items.map((it) => (
          <li key={it.key} className="sch-dep-item" data-testid="S-61.item" data-done={it.done ? "true" : "false"} data-key={it.key}>
            {/* Статус — кружок с галочкой либо пустой контур: цвет подсказывает, форма несёт смысл (AR-80). */}
            <span className={it.done ? "sch-dep-mark sch-dep-mark--done" : "sch-dep-mark"} aria-label={it.done ? "сделано" : "не сделано"}>
              {it.done ? <Icon name="check" size={18} /> : null}
            </span>
            <span className="sch-dep-item-text">
              <span className="sch-dep-item-title">{it.title}</span>
              <span className="sch-muted">{it.detail}</span>
              <span className="sch-dep-item-owner">
                <Badge tone="muted">{OWNER_LABELS[it.owner]}</Badge>
              </span>
            </span>
            <Button kind="ghost" testId="S-61.btn.go" onClick={() => navigate(it.to)}>
              Открыть
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─────────────────────────── скелетон той же геометрии (§0) ───────────────────────────

function DeputySkeleton() {
  return (
    <div data-testid="state.loading">
      <div className="sch-page-head">
        <h1>Кабинет завуча</h1>
      </div>
      <div className="sch-stats">
        <div className="sch-skeleton sch-skeleton--card" />
        <div className="sch-skeleton sch-skeleton--card" />
        <div className="sch-skeleton sch-skeleton--card" />
      </div>
      <div className="sch-dep-cols">
        {[0, 1].map((col) => (
          <div key={col} className="sch-card sch-dep-list">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="sch-skeleton sch-skeleton--row" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

