/**
 * `S-14` · КПЦ — родители (AR-155): карточки родителей, связи с детьми,
 * именной QR и отзыв активации. Связи ведёт модератор вручную (решение
 * владельца 2026-08-28) — самопривязки не существует.
 */
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ACCESS_PARAMS, type ClassDto, type CredentialsDto, type GuardianCardDto, type StudentDto } from "@edustore/shared";
import { api, SchoolApiError } from "../api";
import { useAsync, useIsMobile, usePolling } from "../hooks";
import { Avatar, Badge, Button, EmptyState, ErrorState, Modal, Skeletons, Toast, useToast } from "../ui";
import { useSession } from "../session";
import { navigate } from "../router";
import { AccountForm, CredentialsBox } from "./account-form";

export function GuardiansScreen({ openId }: { openId?: string }) {
  const { can } = useSession();
  const [state, reload] = useAsync(() => api.guardians());
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<CredentialsDto | null>(null);
  const mayManage = can("contingent.write");

  if (state.status === "loading") return <Skeletons count={6} />;
  if (state.status === "error") return <ErrorState message={state.message} onRetry={reload} />;

  const cards = state.data;
  const open = openId ? cards.find((c) => c.id === openId) ?? null : null;

  return (
    <>
      <div className="sch-page-head">
        <h1>Родители</h1>
        {mayManage ? (
          <Button kind="primary" testId="S-14.btn.addGuardian" onClick={() => setAdding(true)}>
            Добавить родителя
          </Button>
        ) : null}
      </div>

      {cards.length === 0 ? (
        <EmptyState
          testId="S-14.empty"
          title="Родителей пока нет"
          hint={mayManage ? "Заведите учётку и свяжите её с детьми" : ""}
        />
      ) : (
        <div className="sch-cards--3">
          {cards.map((c) => (
            <button
              key={c.id}
              className="sch-card sch-card--clickable"
              data-testid="S-14.card.guardian"
              onClick={() => navigate(`/guardians/${c.id}`)}
            >
              <div className="sch-row">
                <Avatar name={c.name} />
                <span>
                  <span className="sch-card-title">{c.name ?? "Учётка не заведена"}</span>
                  <br />
                  <span className="sch-card-sub">
                    {c.children.length > 0 ? c.children.map((k) => `${k.name} · ${k.classLabel}`).join(", ") : "дети не привязаны"}
                  </span>
                </span>
              </div>
              {!c.registered ? (
                <div style={{ marginTop: "var(--sp-12)" }}>
                  <Badge muted>не авторизован</Badge>
                </div>
              ) : null}
            </button>
          ))}
        </div>
      )}

      {adding ? (
        <Modal title="Новая учётка родителя" width={440} onClose={() => setAdding(false)} testId="M-18" mobile="fullscreen">
          <AccountForm
            submitLabel="Завести учётку"
            testPrefix="S-14.add"
            onSubmit={async (dto) => {
              const r = await api.createGuardian(dto);
              setAdding(false);
              setCreated(r.credentials);
              reload();
            }}
          />
        </Modal>
      ) : null}
      {created ? (
        <Modal title="Учётка заведена" width={440} onClose={() => setCreated(null)} testId="M-17" mobile="sheet">
          <CredentialsBox credentials={created} />
        </Modal>
      ) : null}

      {open ? <GuardianModal card={open} onClose={() => navigate("/guardians")} onChanged={reload} /> : null}
    </>
  );
}

function GuardianModal({ card, onClose, onChanged }: { card: GuardianCardDto; onClose: () => void; onChanged: () => void }) {
  const { can } = useSession();
  const [cur, setCur] = useState(card);
  const [token, setToken] = useState<string | null>(null);
  const [creds, setCreds] = useState<CredentialsDto | null>(null);
  const [linking, setLinking] = useState(false);
  const { toast, showToast } = useToast();
  const mayManage = can("contingent.write");
  const qrSize = useIsMobile() ? 200 : 240;

  useEffect(() => {
    if (cur.registered || !cur.userId || !mayManage) return;
    api
      .guardianActivationToken(cur.id)
      .then((t) => setToken(t.token))
      .catch(() => undefined);
  }, [cur.id, cur.registered, cur.userId, mayManage]);

  usePolling(
    async () => {
      const r = await api.guardianActivationStatus(cur.id).catch(() => null);
      if (r?.registeredName) {
        const fresh = await api.guardian(cur.id).catch(() => null);
        if (fresh) setCur(fresh);
        onChanged();
      }
    },
    ACCESS_PARAMS.pollIntervalMs,
    Boolean(cur.userId) && !cur.registered && mayManage,
  );

  const act = async (fn: () => Promise<GuardianCardDto | { ok: boolean }>) => {
    try {
      const r = await fn();
      if (r && typeof r === "object" && "id" in r) setCur(r as GuardianCardDto);
      onChanged();
    } catch (e) {
      showToast(e instanceof SchoolApiError ? e.message : "Не получилось");
    }
  };

  return (
    <>
      <Modal title={cur.name ?? "Карточка родителя"} width={480} onClose={onClose} testId="M-19" mobile="fullscreen">
        <div className="sch-stack">
          {!cur.registered ? (
            <div className="sch-qr">
              <h3 data-testid="S-14.qr.fullName" style={{ margin: 0 }}>
                {cur.name}
              </h3>
              <div className="sch-qr-frame" data-testid="S-14.qr">
                {token ? (
                  <QRCodeSVG value={`${window.location.origin}/join/${token}`} size={qrSize} />
                ) : (
                  <div className="sch-skeleton sch-skeleton--qr" />
                )}
              </div>
              <p className="sch-muted">@{cur.username}</p>
            </div>
          ) : (
            <p data-testid="S-14.status">
              Авторизован{cur.username ? <span className="sch-muted"> · @{cur.username}</span> : null}
            </p>
          )}

          <h3 style={{ marginBottom: 0 }}>Дети</h3>
          {cur.children.length === 0 ? (
            <p className="sch-muted" data-testid="S-14.children.empty">
              Дети не привязаны
            </p>
          ) : (
            <div className="sch-stack" data-testid="S-14.children">
              {cur.children.map((k) => (
                <div key={k.studentId} className="sch-row sch-row--between">
                  <span>
                    {k.name} · {k.classLabel}
                  </span>
                  {mayManage ? (
                    <Button kind="ghost" testId="S-14.btn.unlink" onClick={() => act(() => api.removeGuardianLink(cur.id, k.studentId))}>
                      Отвязать
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {mayManage ? (
            <div className="sch-actions sch-actions--start">
              <Button kind="secondary" testId="S-14.btn.link" onClick={() => setLinking(true)}>
                Привязать ребёнка
              </Button>
              <Button kind="ghost" testId="S-14.btn.reissuePassword" onClick={async () => {
                try {
                  setCreds(await api.guardianCredentials(cur.id));
                } catch (e) {
                  showToast(e instanceof SchoolApiError ? e.message : "Не получилось");
                }
              }}>
                Перевыпустить пароль
              </Button>
              {cur.registered ? (
                <Button kind="danger" testId="S-14.btn.revokeActivation" onClick={() => act(() => api.revokeGuardianActivation(cur.id))}>
                  Отозвать активацию
                </Button>
              ) : null}
              <Button
                kind="danger"
                testId="S-14.btn.delete"
                onClick={async () => {
                  try {
                    await api.deleteGuardian(cur.id);
                    onChanged();
                    onClose();
                  } catch (e) {
                    showToast(e instanceof SchoolApiError ? e.message : "Не получилось");
                  }
                }}
              >
                Удалить
              </Button>
            </div>
          ) : null}
          {creds ? <CredentialsBox credentials={creds} /> : null}
        </div>
      </Modal>

      {linking ? (
        <StudentPicker
          exclude={new Set(cur.children.map((k) => k.studentId))}
          onPick={async (sid) => {
            await act(() => api.addGuardianLink(cur.id, sid));
            setLinking(false);
          }}
          onClose={() => setLinking(false)}
        />
      ) : null}
      {toast ? <Toast text={toast} /> : null}
    </>
  );
}

/** Выбор ученика: класс → список ФИО. Ищем глазами — школа события небольшая. */
function StudentPicker({ exclude, onPick, onClose }: { exclude: Set<string>; onPick: (sid: string) => Promise<void>; onClose: () => void }) {
  const [classes, setClasses] = useState<ClassDto[] | null>(null);
  const [classId, setClassId] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentDto[] | null>(null);

  useEffect(() => {
    api
      .classes()
      .then((r) => setClasses(r.classes))
      .catch(() => setClasses([]));
  }, []);
  useEffect(() => {
    if (!classId) return;
    setStudents(null);
    api
      .students(classId)
      .then(setStudents)
      .catch(() => setStudents([]));
  }, [classId]);

  return (
    <Modal title="Привязать ребёнка" width={440} onClose={onClose} testId="M-20" mobile="sheet" level={2}>
      {classes === null ? (
        <Skeletons count={3} kind="row" />
      ) : classId === null ? (
        <div className="sch-chips">
          {classes.map((c) => (
            <button key={c.id} className="sch-chip" onClick={() => setClassId(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
      ) : students === null ? (
        <Skeletons count={4} kind="row" />
      ) : (
        <div className="sch-stack">
          <Button kind="ghost" onClick={() => setClassId(null)}>
            ← Классы
          </Button>
          {students
            .filter((s) => !exclude.has(s.id) && (s.lastName || s.firstName))
            .map((s) => (
              <Button key={s.id} kind="secondary" onClick={() => void onPick(s.id)}>
                {[s.lastName, s.firstName].filter(Boolean).join(" ")}
              </Button>
            ))}
        </div>
      )}
    </Modal>
  );
}
