import type { LessonDetail, LessonMaterial } from "@edustore/shared";
import { Icon } from "@/design/Icon";
import type { SectionProps } from "@/sections/types";
import { usePlanning } from "./context";

function RingMetric({ value, color, label }: { value: number; color: string; label: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const off = c * (1 - value / 100);
  return (
    <div className="metric">
      <div className="metric-ring">
        <svg width="64" height="64" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r={r} fill="none" stroke="#EDEFF3" strokeWidth="6" />
          <circle
            cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="6"
            strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off}
            transform="rotate(-90 32 32)"
            style={{ transition: "stroke-dashoffset .7s cubic-bezier(.22,1,.36,1)" }}
          />
        </svg>
        <span className="metric-val">{value}<i>%</i></span>
      </div>
      <span className="metric-lbl">{label}</span>
    </div>
  );
}

function FileCard({ m }: { m: LessonMaterial }) {
  return (
    <div className="file-card">
      <div className="file-top">
        <span className="file-ico" style={{ color: m.tint, background: m.tint + "14" }}>
          <Icon name={m.icon} size={22} />
        </span>
        <span className="file-fmt">{m.format}</span>
      </div>
      <div className="file-body">
        <div className="file-title">{m.title}</div>
        <div className="file-sub">{m.audience}{m.meta ? " · " + m.meta : ""}</div>
      </div>
      <div className="file-thumb" aria-hidden="true">
        <span className="thumb-line w70" />
        <span className="thumb-line w90" />
        <span className="thumb-line w55" />
        <span className="thumb-line w80" />
      </div>
      <div className="file-actions">
        {([["eye", "Просмотр"], ["share", "Поделиться"], ["print", "Печать"], ["info", "Информация"]] as const).map(
          ([ic, t]) => (
            <button key={ic} className="fa-btn" title={t}><Icon name={ic} size={18} /></button>
          ),
        )}
      </div>
    </div>
  );
}

function typeBadge(t: LessonDetail["type"]) {
  if (t === "TEST") return { t: "Тест", c: "#7C3AED" };
  if (t === "CONTROL") return { t: "Контрольная работа", c: "#DC2626" };
  return { t: "Урок", c: "#2563EB" };
}

export function PlanningScreen({ ctx }: SectionProps) {
  const { detail, loading } = usePlanning();

  if (loading || !detail) {
    return (
      <main className="zone zone-work">
        <div className="placeholder"><span>Загрузка поурочного плана…</span></div>
      </main>
    );
  }

  const m = detail.metrics;
  const badge = typeBadge(detail.type);
  const genPrimary =
    detail.type === "CONTROL"
      ? { label: "Сгенерировать контрольную", icon: "clipboardGen" as const }
      : detail.type === "TEST"
        ? { label: "Сгенерировать бриф-тест", icon: "generator" as const }
        : { label: "Генератор тестов", icon: "generator" as const };

  return (
    <main className="zone zone-work">
      <div className="work-inner work-anim">
        <div className="work-scroll">
          <header className="work-head">
            <div className="work-crumb">
              <span className="badge-type" style={{ color: badge.c, background: badge.c + "12" }}>{badge.t}</span>
              {detail.unit && <span className="crumb-unit">{detail.unit}</span>}
            </div>
            <h1 className="work-title">{detail.title}</h1>
            <ul className="goals">
              {detail.goals.map((g, i) => (
                <li key={i}><span className="goal-dot" />{g}</li>
              ))}
            </ul>
          </header>

          <section className="analytics">
            <div className="block-cap">Аналитика темы</div>
            <div className="metrics">
              <RingMetric value={m.progress} color="#2563EB" label="Прохождение темы" />
              <RingMetric value={m.attendance} color="#16A34A" label="Посещаемость" />
              <RingMetric value={m.performance} color="#D97706" label="Успеваемость" />
              <div className="metric metric-stat">
                <div className="stat-num">{m.submitted}<i>/{m.total}</i></div>
                <span className="metric-lbl">Сдали работу</span>
              </div>
            </div>
          </section>

          {detail.materials.length > 0 && (
            <section className="files">
              <div className="block-cap">Сгенерированные материалы</div>
              <div className="file-grid">
                {detail.materials.map((mat) => <FileCard key={mat.id} m={mat} />)}
              </div>
            </section>
          )}
        </div>

        <footer className="work-foot">
          <button
            className="gen-btn"
            onClick={() => ctx.pushToast({ type: "info", title: "Генератор проверочных", msg: detail.title })}
          >
            <span className="gen-ico"><Icon name="clipboardGen" size={19} /></span>
            Генератор проверочных работ
          </button>
          <button
            className="gen-btn gen-primary"
            onClick={() => ctx.pushToast({ type: "info", title: genPrimary.label, msg: detail.title })}
          >
            <span className="gen-ico"><Icon name={genPrimary.icon} size={19} /></span>
            {genPrimary.label}
          </button>
        </footer>
      </div>
    </main>
  );
}
