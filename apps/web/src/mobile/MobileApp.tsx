import { useEffect, useState } from "react";
import type { NotificationDto, TeacherClass, TeacherProfile } from "@edustore/shared";
import { Icon, type IconName } from "@/design/Icon";
import { api } from "@/lib/api";
import { useMobileJournal } from "./useMobileJournal";
import { MVoice } from "./MVoice";
import { MHome, MJournal, MNotif, MProfile, MSchedule } from "./screens";

const M_TABS: { id: string; label: string; icon: IconName }[] = [
  { id: "home", label: "Главная", icon: "home" },
  { id: "journal", label: "Журнал", icon: "journal" },
  { id: "schedule", label: "Расписание", icon: "schedule" },
  { id: "notif", label: "Уведомления", icon: "bell" },
  { id: "profile", label: "Профиль", icon: "user" },
];

/**
 * Мобильный кабинет (PWA): нижняя навигация + ГОЛОС как основной способ ввода оценок.
 * `framed` — режим предпросмотра на десктопе (рамка телефона); на реальном телефоне
 * рендерится во весь экран (`.m-app`).
 */
export function MobileApp({ framed = false }: { framed?: boolean }) {
  const [tab, setTab] = useState("home");
  const [day, setDay] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [voiceRec, setVoiceRec] = useState(false);

  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [activeClass, setActiveClass] = useState<TeacherClass | null>(null);
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);

  useEffect(() => {
    api.getProfile().then(setProfile).catch(() => {});
    api.getNotifications().then(setNotifications).catch(() => {});
    api
      .getClasses()
      .then((cs) => {
        setClasses(cs);
        setActiveClass(cs.find((c) => c.label === "8А") ?? cs[0] ?? null);
      })
      .catch(() => {});
  }, []);

  const journal = useMobileJournal(activeClass?.classId, activeClass?.subjectId);

  const header = {
    home: { t: "Сегодня", s: "Понедельник, 16 сентября" },
    journal: { t: `Журнал · ${activeClass?.label ?? ""}`, s: `${activeClass?.subject ?? ""} · ${journal.data?.summary.count ?? 0} учеников` },
    schedule: { t: "Расписание", s: "" },
    notif: { t: "Уведомления", s: `${notifications.length} новых` },
    profile: { t: "Профиль", s: profile?.displayName ?? "" },
  }[tab]!;

  const inner = (
    <>
      <div className="m-header">
        <div>
          <div className="m-h-title">{header.t}</div>
          <div className="m-h-sub">{header.s}</div>
        </div>
        <div className="m-h-actions">
          <button className="ghost-ico" onClick={() => { setSearchOpen(true); setTab("journal"); }}>
            <Icon name="search" size={18} />
          </button>
          <button className="ghost-ico" onClick={() => setTab("notif")}>
            <Icon name="bell" size={18} />
            {notifications.length > 0 && <span className="dot-badge" />}
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className="m-search-bar">
          <div className="msb-field">
            <Icon name="search" size={16} />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по ученикам…" />
          </div>
          <button className="msb-cancel" onClick={() => { setSearchOpen(false); setQuery(""); }}>Отмена</button>
        </div>
      )}

      <div className="m-content" key={tab + (searchOpen ? "s" : "")}>
        {tab === "home" && <MHome notifications={notifications} />}
        {tab === "journal" && (
          <MJournal journal={journal} classes={classes} activeClass={activeClass} onSelectClass={setActiveClass} query={query} />
        )}
        {tab === "schedule" && <MSchedule day={day} setDay={setDay} />}
        {tab === "notif" && <MNotif notifications={notifications} />}
        {tab === "profile" && <MProfile profile={profile} />}
      </div>

      {tab === "journal" && !voiceRec && journal.latestLessonId && (
        <button className="m-fab" onClick={() => setVoiceRec(true)} title="Голосовой ввод оценки">
          <Icon name="mic" size={24} />
        </button>
      )}
      {voiceRec && activeClass && journal.latestLessonId && (
        <MVoice
          classId={activeClass.classId}
          lessonId={journal.latestLessonId}
          onConfirm={(studentId, grade) => {
            journal.setGrade(studentId, journal.latestLessonId!, grade);
            setVoiceRec(false);
          }}
          onCancel={() => setVoiceRec(false)}
        />
      )}

      <nav className="m-tabbar">
        {M_TABS.map((t) => (
          <button
            key={t.id}
            className={"m-tab" + (tab === t.id ? " on" : "")}
            onClick={() => { setTab(t.id); setSearchOpen(false); }}
          >
            <Icon name={t.icon} size={21} />
            {t.label}
          </button>
        ))}
      </nav>
    </>
  );

  // Реальный телефон — во весь экран; десктоп-предпросмотр — в рамке телефона.
  if (framed) {
    return (
      <div className="device-stage">
        <div className="phone">
          <div className="phone-notch" />
          {inner}
        </div>
      </div>
    );
  }
  return <div className="m-app">{inner}</div>;
}
