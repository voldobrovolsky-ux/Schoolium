import { Icon, type IconName } from "@/admin/ds/Icon";
import { Button } from "@/admin/ds/components";

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  {
    icon: "mic",
    title: "Журнал с голосовым вводом",
    text: "Учитель ведёт урок голосом — оценки, темы и замечания попадают в журнал без кликов.",
  },
  {
    icon: "calendar-clock",
    title: "Авторасписание",
    text: "Расписание собирается автоматически: нагрузка, кабинеты, подгруппы и замены — учтены.",
  },
  {
    icon: "users",
    title: "Кабинеты специалистов",
    text: "Завуч, методист, психолог, родитель и ученик — у каждого свой кабинет и свои данные.",
  },
  {
    icon: "sparkles",
    title: "Персонализация обучения",
    text: "Индивидуальные траектории и материалы под каждого ученика на основе его результатов.",
  },
];

/** Режим 1 — публичный лендинг для школ. «Войти» уводит на вход через Флёрус. */
export function Landing({ onLogin, banner }: { onLogin: () => void; banner?: string }) {
  return (
    <div className="lf">
      <header className="lf-top">
        <span className="lf-logo">
          <Icon name="graduation-cap" size={22} />
        </span>
        <span className="lf-brand">EduStore</span>
        <span className="lf-by">Flōr Group</span>
        <div style={{ flex: 1 }} />
        <Button variant="secondary" icon={<Icon name="log-in" size={16} />} onClick={onLogin}>
          Войти
        </Button>
      </header>

      {banner && (
        <div className="lf-note">
          <Icon name="scan-line" size={16} />
          {banner}
        </div>
      )}

      <section className="lf-hero">
        <div className="lf-kicker">Образовательная экосистема для школ</div>
        <h1 className="lf-title">
          Школа, которая <span>работает за вас</span>
        </h1>
        <p className="lf-lead">
          EduStore берёт на себя журнал, расписание и отчётность — а учителю оставляет урок.
          Голосовой ввод, авторасписание и персонализация обучения в одном кабинете.
        </p>
        <div className="lf-cta">
          <Button variant="create" size="lg" icon={<Icon name="log-in" size={18} />} onClick={onLogin}>
            Войти через Флёрус
          </Button>
          <span className="lf-cta__hint">Вход по аккаунту Флёр&nbsp;Group</span>
        </div>
      </section>

      <section className="lf-grid">
        {FEATURES.map((f) => (
          <article key={f.title} className="lf-card">
            <span className="lf-card__ico">
              <Icon name={f.icon} size={22} strokeWidth={2.1} />
            </span>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </article>
        ))}
      </section>

      <footer className="lf-foot">
        <span>EduStore · edustore-flor-group.ru</span>
        <span>© {new Date().getFullYear()} Flōr Group</span>
      </footer>
    </div>
  );
}
