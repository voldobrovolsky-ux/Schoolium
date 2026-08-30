/**
 * Контур входа: `S-00` лендинг, `S-01` привязка устройства, `S-05` код от
 * модератора, `S-03` регистрация по QR, `S-04` фото, `/bootstrap/:token`.
 *
 * Все пять экранов показываются БЕЗ оболочки (§2.3): ни сайдбара, ни топбара —
 * единственный элемент шапки это логотип. Кнопки регистрации на сайте нет и не
 * будет (AR-95): пользователей заводит школа, самостоятельной регистрации не
 * существует как класса.
 */
import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ACCESS_PARAMS, safeNext } from "@edustore/shared";
import { api, SchoolApiError } from "../api";
import { Button, Field, Modal } from "../ui";
import { CameraDenied, hasCamera, parseQr, QrCamera } from "../qr";
import { useIsMobile, usePolling } from "../hooks";
import { navigate } from "../router";

/**
 * Токен привязки устройства (`S-01.qr`/`M-21.qr`): выпуск, поллинг раз в 2 с
 * (AR-87), истёкший QR перевыпускается сам — человек видит новый код, а не
 * ошибку. Один контур входа, две точки показа (экран и модалка) — логика одна.
 */
function useDeviceLink(active: boolean, next: string | null) {
  const [token, setToken] = useState<{ id: string; token: string } | null>(null);
  const [status, setStatus] = useState<"waiting" | "used" | "expired">("waiting");
  const [error, setError] = useState<string | null>(null);

  const issue = () => {
    setError(null);
    api
      .deviceLinkToken(next ?? undefined)
      .then((t) => {
        setToken({ id: t.id, token: t.token });
        setStatus("waiting");
      })
      .catch((e: unknown) => setError(e instanceof SchoolApiError ? e.message : "Не удалось получить код"));
  };

  useEffect(() => {
    if (active) issue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  usePolling(
    async () => {
      if (!token) return;
      const r = await api.deviceLinkStatus(token.id).catch(() => null);
      if (!r) return;
      if (r.status === "used") {
        setStatus("used");
        window.location.assign(safeNext(r.nextPath ?? null, "/classes"));
      } else if (r.status === "expired") issue();
    },
    ACCESS_PARAMS.pollIntervalMs,
    active && status === "waiting",
  );

  return { token, status, error, issue };
}

function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="sch sch-auth">
      <div className="sch-logo" style={{ fontSize: "var(--fs-h2)" }}>
        Schoolium
      </div>
      {children}
    </div>
  );
}

// ─────────────────────────── S-00 · лендинг ───────────────────────────

export function LandingScreen({ authed, startScreen }: { authed: boolean; startScreen: string }) {
  const [loginOpen, setLoginOpen] = useState(false);
  return (
    <div className="sch sch-landing">
      <header className="sch-landing-top">
        <div className="sch-logo" data-testid="S-00.logo">
          Schoolium
        </div>
      </header>

      {/* Премиальный минимум (правка владельца 2026-08-30): заголовок, одна
          строка, одна кнопка. Кнопки регистрации нет и не будет (AR-95). */}
      <div className="sch-hero" data-testid="S-00.hero">
        <h1>
          Школа
          <br />
          <span className="sch-hero-accent">в одном месте</span>
        </h1>
        <p>Дневник · Журнал · Расписание</p>
        <Button kind="primary" testId="S-00.btn.login" onClick={() => (authed ? navigate(startScreen) : setLoginOpen(true))}>
          Войти
        </Button>
      </div>

      {loginOpen ? <LoginModal onClose={() => setLoginOpen(false)} /> : null}
    </div>
  );
}

// ─────────────────────────── M-21 · модалка входа ───────────────────────────

/**
 * Вход с лендинга (правка владельца 2026-08-30, дословно): «модалка посередине
 * экрана, там либо QR, либо окошки для цифр» — и НИЧЕГО больше: без подсказок,
 * статусов и пароля (пароль остаётся на `/login`). Кнопка одна, меняет
 * содержимое и свою подпись. Дефолт: десктоп — QR, телефон — окошки.
 */
function LoginModal({ onClose }: { onClose: () => void }) {
  const mobile = useIsMobile();
  const [mode, setMode] = useState<"qr" | "code">(mobile ? "code" : "qr");
  const link = useDeviceLink(mode === "qr", null);

  return (
    <Modal title="Вход" width={380} onClose={onClose} testId="M-21" mobile="sheet">
      <div className="sch-stack" style={{ alignItems: "center", textAlign: "center" }}>
        {mode === "qr" ? (
          link.error ? (
            <>
              <p className="sch-danger-text" role="alert">
                {link.error}
              </p>
              <Button kind="secondary" onClick={link.issue}>
                Повторить
              </Button>
            </>
          ) : (
            <div className="sch-qr-frame" data-testid="M-21.qr">
              {link.token ? (
                <QRCodeSVG value={`${window.location.origin}/link/${link.token.token}`} size={220} />
              ) : (
                <div className="sch-skeleton sch-skeleton--qr" />
              )}
            </div>
          )
        ) : (
          <ModalCodeEntry />
        )}
        <Button kind="secondary" testId="M-21.btn.mode" onClick={() => setMode(mode === "qr" ? "code" : "qr")}>
          {mode === "qr" ? "Войти по коду" : "Войти по QR"}
        </Button>
      </div>
    </Modal>
  );
}

/** Окошки кода в модалке — тот же контракт, что `S-05.code`, без сканера. */
function ModalCodeEntry() {
  const [digits, setDigits] = useState<string[]>(Array(ACCESS_PARAMS.loginCodeDigits).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const submit = async (code: string) => {
    setBusy(true);
    try {
      const r = await api.verifyLoginCode(code);
      window.location.assign(r.startScreen);
    } catch (e) {
      setError(e instanceof SchoolApiError ? e.message : "Неверный код");
      setDigits(Array(ACCESS_PARAMS.loginCodeDigits).fill(""));
      refs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  };

  const setAt = (i: number, v: string) => {
    const d = v.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[i] = d;
    setDigits(next);
    setError(null);
    if (d && i < digits.length - 1) refs.current[i + 1]?.focus();
    const code = next.join("");
    if (code.length === ACCESS_PARAMS.loginCodeDigits && !next.includes("")) void submit(code);
  };

  return (
    <>
      <div className={error ? "sch-code-cells sch-shake" : "sch-code-cells"} data-testid="M-21.code">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => (refs.current[i] = el)}
            className="sch-code-cell"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            value={d}
            disabled={busy}
            aria-label={`Цифра ${i + 1}`}
            autoFocus={i === 0}
            onChange={(e) => setAt(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
            }}
          />
        ))}
      </div>
      {error ? (
        <p className="sch-danger-text" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

// ─────────────────────────── S-01 · вход, привязка устройства ───────────────────────────

export function LoginScreen({ next }: { next: string | null }) {
  const mobile = useIsMobile();
  const { token, status, error, issue } = useDeviceLink(true, next);

  /*
   * `S-01` на мобайле НЕ показывает QR (§6): телефон не сканирует сам себя, и
   * код, который некому навести на камеру, — это тупик с картинкой. Вместо
   * него — прямое объяснение, откуда берётся доступ, и ссылка на `S-05`.
   * Поллинг при этом продолжается: если ноутбук рядом уже отсканировал код,
   * телефон уйдёт внутрь сам.
   */
  if (mobile) {
    return (
      <AuthFrame>
        <div className="sch-card sch-auth-card sch-stack">
          <p data-testid="S-01.caption">
            Наведите камеру на QR из вашей карточки
          </p>
          <p data-testid="S-01.status">{status === "used" ? "Устройство подключено" : "Ожидание сканирования…"}</p>
          <Button kind="primary" testId="S-01.link.byCode" onClick={() => navigate("/login/code")}>
            Войти по коду от модератора
          </Button>
          <PasswordLoginBlock next={next} />
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <div className="sch-card sch-auth-card sch-qr">
        {error ? (
          <>
            <p className="sch-danger-text" role="alert">
              {error}
            </p>
            <Button kind="secondary" onClick={issue}>
              Повторить
            </Button>
          </>
        ) : (
          <>
            <div className="sch-qr-frame" data-testid="S-01.qr">
              {token ? (
                /* Ссылка своего origin, а не схема `schoolium:` (В1): штатная
                   камера iPhone открывает ссылку сама, а схему без
                   обработчика открыть нечем. */
                <QRCodeSVG value={`${window.location.origin}/link/${token.token}`} size={240} />
              ) : (
                <div className="sch-skeleton sch-skeleton--qr" />
              )}
            </div>
            <p data-testid="S-01.caption" className="sch-muted">
              Наведите камеру телефона, в котором уже открыт кабинет
            </p>
            <p data-testid="S-01.status">{status === "used" ? "Устройство подключено" : "Ожидание сканирования…"}</p>
            <Button kind="ghost" testId="S-01.link.byCode" onClick={() => navigate("/login/code")}>
              Нет телефона под рукой? Войти по коду от модератора
            </Button>
            <PasswordLoginBlock next={next} />
          </>
        )}
      </div>
    </AuthFrame>
  );
}


// ─────────────── S-05′ · вход по юзернейму и паролю (AR-156) ───────────────

/**
 * Фолбэк слетевшей сессии: креды выдал модератор вместе с учёткой. Основной
 * вход — QR; форма спрятана за ссылкой, чтобы не конкурировать с ним.
 */
function PasswordLoginBlock({ next }: { next: string | null }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <Button kind="ghost" testId="S-05p.link.open" onClick={() => setOpen(true)}>
        Вход по юзернейму и паролю
      </Button>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.login(form.username.trim().toLowerCase(), form.password);
      window.location.assign(safeNext(next, r.startScreen));
    } catch (e) {
      setError(e instanceof SchoolApiError ? e.message : "Войти не удалось");
      setBusy(false);
    }
  };

  return (
    <div className="sch-stack" style={{ width: "100%" }}>
      <Field
        label="Юзернейм"
        testId="S-05p.input.username"
        value={form.username}
        autoCapitalize="none"
        autoComplete="username"
        onChange={(e) => setForm({ ...form, username: e.target.value })}
      />
      <Field
        label="Пароль"
        testId="S-05p.input.password"
        type="password"
        value={form.password}
        autoComplete="current-password"
        onChange={(e) => setForm({ ...form, password: e.target.value })}
        error={error}
      />
      <Button
        kind="primary"
        testId="S-05p.btn.submit"
        disabled={!form.username.trim() || !form.password}
        loading={busy}
        onClick={submit}
      >
        Войти
      </Button>
    </div>
  );
}

// ─────────────────────────── S-05 · вход по коду ───────────────────────────

export function LoginCodeScreen({ code }: { code?: string }) {
  const [digits, setDigits] = useState<string[]>(
    code ? code.split("") : Array(ACCESS_PARAMS.loginCodeDigits).fill(""),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [denied, setDenied] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const submit = async (code: string) => {
    setBusy(true);
    try {
      const r = await api.verifyLoginCode(code);
      window.location.assign(r.startScreen);
    } catch (e) {
      // Ошибка: встряска + очистка (`S-05.code` состояния)
      setError(e instanceof SchoolApiError ? e.message : "Неверный код");
      setDigits(Array(ACCESS_PARAMS.loginCodeDigits).fill(""));
      refs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  };

  /*
   * Код, пришедший ССЫЛКОЙ из QR (`/login/code/123456`), отправляется сам —
   * человек уже подтвердил намерение, наведя камеру. Просить его нажать ещё
   * раз значит попросить дважды сделать одно.
   */
  const sent = useRef(false);
  useEffect(() => {
    if (!code || sent.current) return;
    sent.current = true;
    void submit(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const setAt = (i: number, v: string) => {
    const d = v.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[i] = d;
    setDigits(next);
    setError(null);
    if (d && i < digits.length - 1) refs.current[i + 1]?.focus();
    const code = next.join("");
    if (code.length === ACCESS_PARAMS.loginCodeDigits && !next.includes("")) void submit(code);
  };

  /*
   * `S-05.btn.scan` — «открывает камеру, скан того же кода» (реестр §S-05).
   * До этапа 3 кнопка рендерилась БЕЗ обработчика: нажималась и не делала
   * ничего, при том что модератор показывает рядом QR кода входа. G-52 такую
   * дыру не ловит по построению — она проверяет, что идентификатор стоит на
   * экране, а не что за ним есть поведение.
   *
   * Камера открывается ЗДЕСЬ, а не переходом на `S-70`: `S-05` — экран
   * анонима, а `S-70` живёт за сессией. Отправлять человека без доступа на
   * экран, требующий доступа, значит закрыть ему единственный путь внутрь.
   */
  if (scanning) {
    /* Отказ в камере не должен запирать человека в сканере: `S-05` — это
       экран ВХОДА, и ручной ввод кода остаётся рабочим путём. Без возврата
       единственным выходом была бы перезагрузка страницы. */
    if (denied)
      return (
        <AuthFrame>
          <div className="sch-stack sch-auth-card">
            <CameraDenied testId="S-05.error.denied" />
            <Button kind="primary" onClick={() => { setDenied(false); setScanning(false); }}>
              Ввести код руками
            </Button>
          </div>
        </AuthFrame>
      );
    return (
      <QrCamera
        testId="S-05.viewfinder"
        hint="Наведите камеру на QR из карточки, которую открыл модератор"
        onDenied={() => setDenied(true)}
        onCancel={() => setScanning(false)}
        onCode={(raw) => {
          const qr = parseQr(raw);
          if (qr?.kind !== "code") return setError("Это не код входа");
          setScanning(false);
          setDigits(qr.value.split(""));
          void submit(qr.value);
        }}
      />
    );
  }

  return (
    <AuthFrame>
      <div className="sch-card sch-auth-card sch-stack">
        <div className={error ? "sch-code-cells sch-shake" : "sch-code-cells"} data-testid="S-05.code">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => (refs.current[i] = el)}
              className="sch-code-cell"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={1}
              value={d}
              disabled={busy}
              aria-label={`Цифра ${i + 1}`}
              autoFocus={i === 0}
              onChange={(e) => setAt(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
              }}
            />
          ))}
        </div>
        {error ? (
          <p className="sch-danger-text" role="alert">
            {error}
          </p>
        ) : null}
        <p className="sch-muted" data-testid="S-05.hint">
          Шесть цифр с вашей карточки
        </p>
        {/* Кнопка сканера скрыта, если камеры нет (§6). */}
        {hasCamera() ? (
          <Button kind="secondary" testId="S-05.btn.scan" onClick={() => setScanning(true)}>
            Сканировать QR
          </Button>
        ) : null}
        <Button kind="ghost" testId="S-05.btn.back" onClick={() => navigate("/login")}>
          К входу по QR
        </Button>
      </div>
    </AuthFrame>
  );
}



// ─────────────────── S-03′ · активация одним сканом (AR-161) ───────────────────

export function JoinScreen({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [noSession, setNoSession] = useState(false);

  // Учётка заведена модератором целиком: скан именного QR и есть «я — это я».
  // Человек не вводит ничего — страница активирует вход сама и ведёт в кабинет.
  useEffect(() => {
    let cancelled = false;
    api
      .join(token)
      .then(async (r) => {
        if (cancelled) return;
        if (r.hasSession) {
          // персонал идёт через фото профиля; ученик и родитель — сразу в
          // дневник: аватарки у их ролей нет (S-04 держится на staff.self.write)
          const me = await api.me().catch(() => null);
          if (me && !me.permissions.includes("staff.self.write")) window.location.assign(me.startScreen);
          else navigate(`/join/${token}/photo`);
        }
        // QR открыт под чужой живой сессией (устройство модератора, AR-91):
        // якорь не выдан — человек входит кодом с карточки со своего устройства
        else setNoSession(true);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof SchoolApiError ? e.message : "Не удалось активировать вход");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <AuthFrame>
      <div className="sch-card sch-auth-card">
        <h2 data-testid="S-03.header.role">Вход в Schoolium</h2>
        {error ? (
          <p className="sch-error" data-testid="S-03.error" role="alert">
            {error}
          </p>
        ) : noSession ? (
          <p data-testid="S-03.hint.otherDevice">
            Это устройство уже занято другой учёткой. Откройте ссылку со своего телефона
            или войдите кодом с карточки: «Вход по коду» на странице входа.
          </p>
        ) : (
          <p data-testid="S-03.hint.progress">Подключаем устройство…</p>
        )}
      </div>
    </AuthFrame>
  );
}

// ─────────────────────────── S-04 · фото профиля ───────────────────────────

export function PhotoScreen() {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <AuthFrame>
      <div className="sch-card sch-auth-card sch-stack" style={{ alignItems: "center" }}>
        <div data-testid="S-04.avatar">
          {url ? (
            <img className="sch-avatar sch-avatar--lg" src={url} alt="Фото профиля" />
          ) : (
            <span className="sch-avatar sch-avatar--lg">·</span>
          )}
        </div>
        <Button
          kind="secondary"
          testId="S-04.btn.attach"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            // В 1.1.1 аватар — ссылка: файловое хранилище принадлежит контуру
            // Документохранилища (1.1.2), и тянуть его сюда рано.
            const value = window.prompt("Ссылка на фото");
            if (value) {
              await api.setAvatar(value).catch(() => undefined);
              setUrl(value);
            }
            setBusy(false);
          }}
        >
          Прикрепить фото
        </Button>
        {/* Пропуск фото — ПОЛНОЦЕННЫЙ путь, а не «отложить на потом». */}
        <Button
          kind="primary"
          testId="S-04.btn.skip"
          onClick={async () => {
            const me = await api.me().catch(() => null);
            window.location.assign(me?.startScreen ?? "/classes");
          }}
        >
          Продолжить
        </Button>
      </div>
    </AuthFrame>
  );
}

// ─────────────────────────── /bootstrap/:token · первый модератор (AR-93) ───────────────────────────

export function BootstrapScreen({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .consumeBootstrap(token)
      .then((r) => window.location.assign(r.startScreen))
      .catch((e: unknown) => setError(e instanceof SchoolApiError ? e.message : "Ссылка недействительна"));
  }, [token]);
  return (
    <AuthFrame>
      <div className="sch-card sch-auth-card sch-stack">
        {error ? (
          <>
            <p className="sch-danger-text" role="alert">
              {error}
            </p>
            <p className="sch-muted">
              Ссылка одноразова и живёт {ACCESS_PARAMS.bootstrapLinkTtlHours} часа. Новую выпускает администратор
              платформы.
            </p>
          </>
        ) : (
          <p>Входим…</p>
        )}
      </div>
    </AuthFrame>
  );
}
