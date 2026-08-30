import type { NotificationDto, TeacherClass, TeacherProfile, GradeValue } from "@edustore/shared";
import { gradeClass } from "@edustore/shared";
import { Icon } from "@/design/Icon";
import { usePrefs } from "@/app/prefs";
import { TODAY_LESSONS, WEEK_DAYS, WEEK_SCHEDULE } from "./scheduleData";
import type { useMobileJournal } from "./useMobileJournal";

const lc = (t: string) => t.toLowerCase();

export function MHome({ notifications }: { notifications: NotificationDto[] }) {
  const next = TODAY_LESSONS[0];
  return (
    <div className="work-anim">
      <div className="m-next">
        <div className="mn-cap">Следующий урок · через 20 мин</div>
        <div className="mn-title">{next.title}</div>
        <div className="mn-meta"><span>{next.time}</span><span>{next.cls}</span><span>{next.room}</span></div>
      </div>
      <div className="m-sec-cap">Уроки сегодня</div>
      {TODAY_LESSONS.map((l, i) => (
        <div key={i} className="m-lesson">
          <span className="ml-time">{l.time}</span>
          <div className="ml-body"><b>{l.title}</b><span>{l.cls}</span></div>
          <span className="ml-dot" style={{ background: l.color }} />
        </div>
      ))}
      <div className="m-sec-cap">Последние уведомления</div>
      {notifications.slice(0, 2).map((n) => (
        <div key={n.id} className={"m-notif " + lc(n.type)}>
          <div className="mnf-ico"><Icon name={n.icon} size={17} /></div>
          <div><div className="mnf-t">{n.title}</div><div className="mnf-time">{n.time}</div></div>
        </div>
      ))}
    </div>
  );
}

export function MSchedule({ day, setDay }: { day: number; setDay: (u: (d: number) => number) => void }) {
  return (
    <div className="work-anim">
      <div className="m-day-nav">
        <button onClick={() => setDay((d) => Math.max(0, d - 1))}><Icon name="chevLeft" size={18} /></button>
        <b>{WEEK_DAYS[day]}</b>
        <button onClick={() => setDay((d) => Math.min(WEEK_DAYS.length - 1, d + 1))}><Icon name="chevRight" size={18} /></button>
      </div>
      {WEEK_SCHEDULE[day].map((l, i) => (
        <div key={i} className="m-sched-item">
          <div className="m-sched-time">{l[0]}</div>
          <div className="m-sched-card"><b>{l[1]}</b><span>{l[2]}</span></div>
        </div>
      ))}
    </div>
  );
}

export function MNotif({ notifications }: { notifications: NotificationDto[] }) {
  return (
    <div className="work-anim">
      {notifications.map((n) => (
        <div key={n.id} className={"m-notif " + lc(n.type)}>
          <div className="mnf-ico"><Icon name={n.icon} size={17} /></div>
          <div>
            <div className="mnf-t">{n.title}</div>
            <div className="mnf-m">{n.message}</div>
            <div className="mnf-time">{n.time}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function MProfile({ profile }: { profile: TeacherProfile | null }) {
  const { theme, set } = usePrefs();
  return (
    <div className="work-anim">
      <div className="m-next" style={{ background: "var(--panel)", color: "var(--ink)", border: "1px solid var(--line)", boxShadow: "var(--shadow)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span className="avatar" style={{ width: 54, height: 54, fontSize: 18 }}>{profile?.initials ?? "—"}</span>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{profile?.displayName ?? "…"}</div>
            <div style={{ fontSize: 13, color: "var(--ink3)" }}>{profile?.role ?? ""}</div>
          </div>
        </div>
      </div>
      <div className="m-sec-cap">Настройки</div>
      <div
        className="m-lesson"
        style={{ cursor: "pointer" }}
        onClick={() => set("theme", theme === "dark" ? "light" : "dark")}
      >
        <span className="ml-time" style={{ width: 28 }}><Icon name={theme === "dark" ? "moon" : "sun"} size={18} /></span>
        <div className="ml-body"><b>Тёмная тема</b><span>{theme === "dark" ? "включена" : "выключена"}</span></div>
        <span className={"switch" + (theme === "dark" ? " on" : "")} style={{ marginLeft: "auto" }} />
      </div>
    </div>
  );
}

const CYCLE: GradeValue[] = ["", "5", "4", "3", "2", "н"];

export function MJournal({
  journal,
  classes,
  activeClass,
  onSelectClass,
  query,
}: {
  journal: ReturnType<typeof useMobileJournal>;
  classes: TeacherClass[];
  activeClass: TeacherClass | null;
  onSelectClass: (c: TeacherClass) => void;
  query: string;
}) {
  const { data, loading, flash, error, setGrade } = journal;
  const q = (query || "").trim().toLowerCase();
  const rows = (data?.rows ?? []).filter((r) => !q || r.name.toLowerCase().includes(q));

  return (
    <div className="work-anim">
      {error && (
        <div
          role="alert"
          style={{
            margin: "0 0 8px", padding: "10px 12px", borderRadius: 10, fontSize: 13,
            background: "rgba(220,38,38,.12)", color: "#DC2626", border: "1px solid rgba(220,38,38,.3)",
          }}
        >
          {error}
        </div>
      )}
      <div className="flags" style={{ marginBottom: 4 }}>
        {classes.map((c) => (
          <button
            key={c.id}
            className={"flag" + (activeClass?.classId === c.classId ? " is-active" : "")}
            onClick={() => onSelectClass(c)}
          >
            <span className="flag-label">{c.label}</span>
            <span className="flag-sub">{c.subject}</span>
          </button>
        ))}
      </div>
      <div className="m-sec-cap">Голосовой ввод — основной способ выставления оценок</div>

      {loading && <div style={{ padding: 24, color: "var(--ink3)", fontSize: 13 }}>Загрузка…</div>}

      {data && (
        <div className="m-jtable-wrap">
          <table className="m-jtable">
            <thead>
              <tr>
                <th className="mjt-name">Ученик</th>
                {data.columns.map((c) => <th key={c.lessonId}>{c.day}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.studentId}>
                  <td className="mjt-name">{r.name}</td>
                  {data.columns.map((c, di) => {
                    const g = r.grades[di] ?? "";
                    const key = `${r.studentId}|${c.lessonId}`;
                    return (
                      <td
                        key={c.lessonId}
                        className="m-jcell"
                        onClick={() => setGrade(r.studentId, c.lessonId, CYCLE[(CYCLE.indexOf(g) + 1) % CYCLE.length])}
                      >
                        {g && <span className={"jmark " + gradeClass(g) + (flash === key ? " fly" : "")}>{g}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
