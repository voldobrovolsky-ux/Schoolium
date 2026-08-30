import { useState } from "react";
import { usePrefs, type Anim, type Density, type Theme } from "@/app/prefs";

// Раздел «Персонализация»: тема, плотность, анимации, поведение меню, цвета предметов.
const SUBJECTS = [
  { id: "alg", name: "Алгебра", color: "#2563EB" },
  { id: "geo", name: "Геометрия", color: "#0EA5E9" },
  { id: "math", name: "Математика", color: "#16A34A" },
  { id: "inf", name: "Информатика", color: "#7C3AED" },
];
const PALETTE = ["#2563EB", "#0EA5E9", "#16A34A", "#D97706", "#DC2626", "#7C3AED", "#DB2777", "#0D9488"];

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map(([v, l]) => (
        <button key={v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export function Personalize() {
  const { theme, density, anim, autoCollapse, set } = usePrefs();
  const [subjects, setSubjects] = useState(SUBJECTS);

  return (
    <div className="pers">
      <div className="pers-inner">
        <h1 className="pers-h1">Персонализация</h1>
        <p className="pers-sub">Настройте комфортное визуальное пространство — всё применяется сразу.</p>

        <section className="pers-sec">
          <div className="pers-sec-t">Оформление</div>
          <div className="pers-card">
            <div className="pers-row">
              <div className="pr-text"><b>Тема</b><span>Светлая или тёмная палитра интерфейса</span></div>
              <Segmented<Theme>
                value={theme}
                options={[["light", "Светлая"], ["dark", "Тёмная"]]}
                onChange={(v) => set("theme", v)}
              />
            </div>
            <div className="pers-row">
              <div className="pr-text"><b>Плотность</b><span>Высота строк и отступы</span></div>
              <Segmented<Density>
                value={density}
                options={[["compact", "Компактно"], ["standard", "Стандарт"], ["spacious", "Просторно"]]}
                onChange={(v) => set("density", v)}
              />
            </div>
            <div className="pers-row">
              <div className="pr-text"><b>Анимации</b><span>Скорость переходов</span></div>
              <Segmented<Anim>
                value={anim}
                options={[["fast", "Быстро"], ["standard", "Стандарт"], ["slow", "Плавно"], ["none", "Выкл"]]}
                onChange={(v) => set("anim", v)}
              />
            </div>
          </div>
        </section>

        <section className="pers-sec">
          <div className="pers-sec-t">Поведение</div>
          <div className="pers-card">
            <div className="pers-row">
              <div className="pr-text"><b>Сворачивать меню</b><span>Левый сайдбар сворачивается в рабочем пространстве</span></div>
              <button
                className={"switch" + (autoCollapse ? " on" : "")}
                onClick={() => set("autoCollapse", !autoCollapse)}
                aria-label="Сворачивать меню"
              />
            </div>
          </div>
        </section>

        <section className="pers-sec">
          <div className="pers-sec-t">Цвета предметов</div>
          <div className="pers-card">
            <div className="subj-grid">
              {subjects.map((s) => (
                <div key={s.id} className="subj-row">
                  <div className="subj-left">
                    <span className="subj-dot" style={{ background: s.color, color: s.color }} />
                    <span className="subj-name">{s.name}</span>
                  </div>
                  <div className="subj-swatches">
                    {PALETTE.map((c) => (
                      <button
                        key={c}
                        className={"subj-sw" + (s.color === c ? " on" : "")}
                        style={{ background: c }}
                        onClick={() => setSubjects((arr) => arr.map((x) => (x.id === s.id ? { ...x, color: c } : x)))}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
