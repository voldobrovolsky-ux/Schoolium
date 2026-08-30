import { useEffect, useRef, useState } from "react";
import { pilotApi, PilotError } from "@/lib/pilotApi";
import "./pilot.css";

/** Спокойный статус-экран «готовим рабочее место» — не ошибка, без техдеталей. */
export function Preparing() {
  return (
    <div className="pilot-viewport">
      <div className="pilot-preparing">
        <div className="orb" />
        <h2>Мы подготавливаем ваше рабочее место</h2>
        <p>Это может занять несколько минут. Не закрывайте страницу — кабинет откроется автоматически.</p>
        <div className="pilot-dots"><i /><i /><i /></div>
      </div>
    </div>
  );
}

/** QR-вход сотрудника: телефон (только ярлык) → вход по токену → подготовка → кабинет. */
export function PilotLogin({ token }: { token: string }) {
  const [phone, setPhone] = useState("");
  const [phase, setPhase] = useState<"form" | "preparing">("form");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const timer = useRef<number | undefined>(undefined);

  const submit = async () => {
    if (!phone.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      await pilotApi.login(token, phone.trim());
      setPhase("preparing");
    } catch (e) {
      setErr(
        e instanceof PilotError && e.status === 404
          ? "Приглашение не найдено или истекло — попросите владельца выдать новый QR"
          : "Не удалось войти. Попробуйте ещё раз",
      );
      setBusy(false);
    }
  };

  // в состоянии «подготовка» опрашиваем cabinet-state; как только «ready» — открываем кабинет
  useEffect(() => {
    if (phase !== "preparing") return;
    let alive = true;
    const tick = async () => {
      try {
        const st = await pilotApi.cabinetState();
        if (alive && st.state === "ready") {
          window.location.href = "/";
          return;
        }
      } catch {
        /* ждём — назначения ещё нет / сеть */
      }
      if (alive) timer.current = window.setTimeout(tick, 4000);
    };
    timer.current = window.setTimeout(tick, 2500);
    return () => {
      alive = false;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [phase]);

  if (!token) {
    return (
      <div className="pilot-viewport">
        <div className="pilot-card pilot-gate">
          <h2>Нет приглашения</h2>
          <p>Отсканируйте QR-код у владельца, чтобы войти.</p>
        </div>
      </div>
    );
  }

  if (phase === "preparing") return <Preparing />;

  return (
    <div className="pilot-viewport">
      <div className="pilot-card pilot-gate">
        <div className="pilot-logo" style={{ margin: "0 auto 12px" }}>E</div>
        <h2>Вход в EduStore</h2>
        <p>Введите номер телефона — он нужен только как подпись в системе. Кода из SMS не будет.</p>
        {err && <div className="pilot-err">{err}</div>}
        <div className="pilot-field">
          <label>Телефон</label>
          <input
            className="pilot-input"
            type="tel"
            inputMode="tel"
            value={phone}
            autoFocus
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="+7 999 000-00-00"
          />
        </div>
        <button className="pilot-btn wide" onClick={submit} disabled={busy || !phone.trim()}>
          {busy ? "Входим…" : "Войти"}
        </button>
      </div>
    </div>
  );
}
