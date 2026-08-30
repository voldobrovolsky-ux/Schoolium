import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Icon } from "@/design/Icon";
import {
  pilotApi,
  PilotError,
  type PilotStaff,
  type PilotClass,
  type PilotSubject,
  type PilotInvite,
} from "@/lib/pilotApi";
import "./pilot.css";

const OWNER_KEY_LS = "edustore-pilot-owner-key";

/** owner-экран пилота: добавить сотрудника → QR, создать дисциплину/класс, назначить. Гейт по ключу. */
export function PilotOwner() {
  const [key, setKey] = useState<string | null>(() => {
    try { return sessionStorage.getItem(OWNER_KEY_LS); } catch { return null; }
  });
  if (!key) return <KeyGate onOk={setKey} />;
  return <OwnerBoard ownerKey={key} onReset={() => { try { sessionStorage.removeItem(OWNER_KEY_LS); } catch { /* */ } setKey(null); }} />;
}

function KeyGate({ onOk }: { onOk: (k: string) => void }) {
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    if (!val.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      await pilotApi.listStaff(val.trim()); // проверка ключа
      try { sessionStorage.setItem(OWNER_KEY_LS, val.trim()); } catch { /* */ }
      onOk(val.trim());
    } catch (e) {
      setErr(e instanceof PilotError && e.status === 403 ? "Неверный ключ owner" : "Пилотный режим недоступен (AUTH_MODE ≠ pilot-qr)");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pilot-viewport">
      <div className="pilot-card pilot-gate">
        <div className="pilot-logo" style={{ margin: "0 auto 12px" }}>E</div>
        <h2>Пилот · owner</h2>
        <p>Разовый экран запуска. Введите ключ владельца, чтобы добавить сотрудников и структуру.</p>
        {err && <div className="pilot-err">{err}</div>}
        <div className="pilot-field">
          <label>Ключ owner</label>
          <input
            className="pilot-input"
            type="password"
            value={val}
            autoFocus
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="PILOT_OWNER_KEY"
          />
        </div>
        <button className="pilot-btn wide" onClick={submit} disabled={busy || !val.trim()}>
          {busy ? "Проверяем…" : "Войти"}
        </button>
      </div>
    </div>
  );
}

function OwnerBoard({ ownerKey, onReset }: { ownerKey: string; onReset: () => void }) {
  const [staff, setStaff] = useState<PilotStaff[]>([]);
  const [classes, setClasses] = useState<PilotClass[]>([]);
  const [subjects, setSubjects] = useState<PilotSubject[]>([]);
  const [qr, setQr] = useState<PilotInvite | null>(null);
  const [err, setErr] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [s, c, su] = await Promise.all([
        pilotApi.listStaff(ownerKey),
        pilotApi.listClasses(ownerKey),
        pilotApi.listSubjects(ownerKey),
      ]);
      setStaff(s); setClasses(c); setSubjects(su);
    } catch (e) {
      setErr((e as Error).message || "Ошибка загрузки");
    }
  }, [ownerKey]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="pilot-viewport">
      <div className="pilot-topbar">
        <div className="pilot-logo">E</div>
        <div className="pilot-titles">
          <h1>EduStore · Пилот</h1>
          <div className="pilot-sub">Экран владельца — школа «Архимед»</div>
        </div>
        <span className="pilot-badge">AUTH_MODE=pilot-qr</span>
        <button className="pilot-btn ghost" style={{ marginLeft: 10 }} onClick={onReset}>Выйти</button>
      </div>

      <div className="pilot-card">
        {err && <div className="pilot-err">{err}</div>}
        <div className="pilot-cols">
          <div>
            <StaffPanel ownerKey={ownerKey} staff={staff} onChange={refresh} onQr={setQr} onErr={setErr} />
            <AssignPanel ownerKey={ownerKey} staff={staff} classes={classes} subjects={subjects} onChange={refresh} onErr={setErr} />
          </div>
          <StructurePanel ownerKey={ownerKey} classes={classes} subjects={subjects} onChange={refresh} onErr={setErr} />
        </div>
      </div>

      {qr && <QrModal invite={qr} onClose={() => setQr(null)} />}
    </div>
  );
}

function StaffPanel({ ownerKey, staff, onChange, onQr, onErr }: {
  ownerKey: string; staff: PilotStaff[]; onChange: () => Promise<void>;
  onQr: (i: PilotInvite) => void; onErr: (m: string) => void;
}) {
  const [role, setRole] = useState<"teacher" | "zavuch">("teacher");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const inv = await pilotApi.addStaff(ownerKey, role, name.trim() || undefined);
      setName("");
      await onChange();
      onQr(inv); // сразу показать QR
    } catch (e) {
      onErr((e as Error).message || "Не удалось добавить");
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (inviteId: string) => {
    try {
      await pilotApi.revokeStaff(ownerKey, inviteId);
      await onChange();
    } catch (e) {
      onErr((e as Error).message || "Не удалось отозвать");
    }
  };
  return (
    <div className="pilot-panel">
      <h3><Icon name="user" size={16} /> Сотрудники</h3>
      {staff.length === 0 && <div className="pilot-empty">Пока никого — добавьте первого сотрудника</div>}
      {staff.map((s) => (
        <div className="pilot-row" key={s.inviteId}>
          <div className="grow">
            <div className="name">{s.displayName || (s.phone ? s.phone : "Без имени")}</div>
            <div className="meta">
              {s.role === "zavuch" ? "Завуч" : "Учитель"}
              {s.phone ? ` · ${s.phone}` : ""}
              {s.assignments.length > 0 ? ` · ${s.assignments.join(", ")}` : ""}
            </div>
          </div>
          {!s.loggedIn ? (
            <span className="pilot-chip role">не вошёл</span>
          ) : s.assigned ? (
            <span className="pilot-chip ok">работает</span>
          ) : (
            <span className="pilot-chip wait">подготовка</span>
          )}
          {!s.loggedIn && s.token && (
            <>
              <button
                className="pilot-mini"
                title="Показать QR ещё раз"
                onClick={() => onQr({ inviteId: s.inviteId, token: s.token!, role: s.role, displayName: s.displayName })}
              >
                QR
              </button>
              <button
                className="pilot-mini danger"
                title="Отозвать приглашение"
                onClick={() => void revoke(s.inviteId)}
              >
                ✕
              </button>
            </>
          )}
        </div>
      ))}
      <div className="pilot-inline" style={{ marginTop: 12 }}>
        <div className="pilot-field">
          <label>Роль</label>
          <select className="pilot-select" value={role} onChange={(e) => setRole(e.target.value as "teacher" | "zavuch")}>
            <option value="teacher">Учитель</option>
            <option value="zavuch">Завуч</option>
          </select>
        </div>
        <div className="pilot-field" style={{ flex: 2 }}>
          <label>Имя (необязательно)</label>
          <input className="pilot-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Иванова Т. С." onKeyDown={(e) => e.key === "Enter" && add()} />
        </div>
        <button className="pilot-btn" onClick={add} disabled={busy}>
          <Icon name="plus" size={16} /> {busy ? "…" : "QR"}
        </button>
      </div>
    </div>
  );
}

function StructurePanel({ ownerKey, classes, subjects, onChange, onErr }: {
  ownerKey: string; classes: PilotClass[]; subjects: PilotSubject[]; onChange: () => Promise<void>; onErr: (m: string) => void;
}) {
  const [parallel, setParallel] = useState("5");
  const [letter, setLetter] = useState("А");
  const [subj, setSubj] = useState("");
  const addClass = async () => {
    try { await pilotApi.createClass(ownerKey, Number(parallel), letter.trim()); setLetter("А"); await onChange(); }
    catch (e) { onErr((e as Error).message); }
  };
  const addSubject = async () => {
    if (!subj.trim()) return;
    try { await pilotApi.createSubject(ownerKey, subj.trim()); setSubj(""); await onChange(); }
    catch (e) { onErr((e as Error).message); }
  };
  return (
    <div className="pilot-panel">
      <h3><Icon name="journal" size={16} /> Классы</h3>
      {classes.length === 0 && <div className="pilot-empty">Классов пока нет</div>}
      {classes.map((c) => (
        <div className="pilot-row" key={c.id}><div className="grow"><div className="name">{c.label}</div></div></div>
      ))}
      <div className="pilot-inline" style={{ marginTop: 10 }}>
        <div className="pilot-field" style={{ maxWidth: 88 }}>
          <label>Параллель</label>
          <select className="pilot-select" value={parallel} onChange={(e) => setParallel(e.target.value)}>
            {Array.from({ length: 11 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="pilot-field" style={{ maxWidth: 72 }}>
          <label>Буква</label>
          <input className="pilot-input" value={letter} maxLength={2} onChange={(e) => setLetter(e.target.value.toUpperCase())} />
        </div>
        <button className="pilot-btn ghost" onClick={addClass}><Icon name="plus" size={16} /></button>
      </div>

      <h3 style={{ marginTop: 20 }}><Icon name="materials" size={16} /> Дисциплины</h3>
      {subjects.length === 0 && <div className="pilot-empty">Дисциплин пока нет</div>}
      {subjects.map((s) => (
        <div className="pilot-row" key={s.id}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
          <div className="grow"><div className="name">{s.name}</div></div>
        </div>
      ))}
      <div className="pilot-inline" style={{ marginTop: 10 }}>
        <div className="pilot-field"><label>Название</label>
          <input className="pilot-input" value={subj} onChange={(e) => setSubj(e.target.value)} placeholder="Математика" onKeyDown={(e) => e.key === "Enter" && addSubject()} />
        </div>
        <button className="pilot-btn ghost" onClick={addSubject}><Icon name="plus" size={16} /></button>
      </div>
    </div>
  );
}

function AssignPanel({ ownerKey, staff, classes, subjects, onChange, onErr }: {
  ownerKey: string; staff: PilotStaff[]; classes: PilotClass[]; subjects: PilotSubject[];
  onChange: () => Promise<void>; onErr: (m: string) => void;
}) {
  const eligible = staff.filter((s) => s.loggedIn && s.userId);
  const [uid, setUid] = useState("");
  const [cid, setCid] = useState("");
  const [sid, setSid] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = uid && cid && sid;
  const assign = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try { await pilotApi.assign(ownerKey, uid, cid, sid); await onChange(); }
    catch (e) { onErr((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="pilot-panel">
      <h3><Icon name="share" size={16} /> Назначение</h3>
      {eligible.length === 0 ? (
        <div className="pilot-empty">Назначать можно после того, как сотрудник вошёл по QR</div>
      ) : (
        <>
          <div className="pilot-field"><label>Сотрудник</label>
            <select className="pilot-select" value={uid} onChange={(e) => setUid(e.target.value)}>
              <option value="">— выберите —</option>
              {eligible.map((s) => <option key={s.userId!} value={s.userId!}>{s.displayName || s.phone || s.userId}</option>)}
            </select>
          </div>
          <div className="pilot-field"><label>Класс</label>
            <select className="pilot-select" value={cid} onChange={(e) => setCid(e.target.value)}>
              <option value="">— выберите —</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div className="pilot-field"><label>Дисциплина</label>
            <select className="pilot-select" value={sid} onChange={(e) => setSid(e.target.value)}>
              <option value="">— выберите —</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <button className="pilot-btn wide" onClick={assign} disabled={!ready || busy}>
            {busy ? "Назначаем…" : "Назначить и открыть кабинет"}
          </button>
        </>
      )}
    </div>
  );
}

function QrModal({ invite, onClose }: { invite: PilotInvite; onClose: () => void }) {
  const link = `${window.location.origin}/?pilot=login&token=${encodeURIComponent(invite.token)}`;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ }
  };
  return (
    <div className="pilot-modal-backdrop" onClick={onClose}>
      <div className="pilot-modal" onClick={(e) => e.stopPropagation()}>
        <div className="eduqr" style={{ margin: "0 auto" }}>
          <QRCodeSVG value={link} size={220} level="H" bgColor="#ffffff" fgColor="#0C0F15" />
        </div>
        <h3>{invite.displayName || (invite.role === "zavuch" ? "Завуч" : "Учитель")}</h3>
        <p>Пусть сотрудник отсканирует QR телефоном и войдёт</p>
        <div className="pilot-token">{invite.token}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="pilot-btn ghost" style={{ flex: 1 }} onClick={copy}>
            <Icon name={copied ? "check" : "share"} size={16} /> {copied ? "Скопировано" : "Копировать ссылку"}
          </button>
          <button className="pilot-btn" style={{ flex: 1 }} onClick={onClose}>Готово</button>
        </div>
      </div>
    </div>
  );
}
