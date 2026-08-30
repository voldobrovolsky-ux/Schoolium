import { useState } from "react";
import { Icon } from "@/admin/ds/Icon";
import { Avatar } from "@/admin/ds/components";
import { EduQR } from "./EduQR";
import { useDeviceFlow } from "./useDeviceFlow";
import { getKioskUsers, forgetKioskUser, type KioskUser } from "./deviceStore";

/**
 * Режим 3 — экран входа на привязанном устройстве (тёмная тема).
 * Слева — карточки учителей, заходивших на этом компьютере. Справа — QR для входа
 * нового учителя (Device Authorization Flow, purpose=login). Клик по карточке: если
 * в браузере есть активная сессия — сразу в кабинет; иначе показываем QR под карточкой.
 */
export function KioskLogin({
  onAuthenticated,
  onUnbind,
}: {
  onAuthenticated: () => void;
  onUnbind: () => void;
}) {
  const [users, setUsers] = useState<KioskUser[]>(getKioskUsers);
  const [picked, setPicked] = useState<string | null>(null);
  const flow = useDeviceFlow({ purpose: "login", enabled: true, onAuthenticated });

  const pick = async (u: KioskUser): Promise<void> => {
    setPicked((id) => (id === u.id ? null : u.id));
    try {
      const r = await fetch("/api/auth/flor/me", { credentials: "include" });
      if (r.ok) onAuthenticated(); // активная сессия → сразу в кабинет
    } catch {
      /* нет сессии — учитель войдёт по QR под карточкой */
    }
  };

  const forget = (id: string): void => {
    forgetKioskUser(id);
    setUsers(getKioskUsers());
    setPicked((p) => (p === id ? null : p));
  };

  return (
    <div className="kl">
      <div className="kl-grid">
        <section className="kl-users">
          <div className="kl-brand">
            <span className="kl-logo">
              <Icon name="graduation-cap" size={20} />
            </span>
            <div>
              <div className="kl-title">EduStore</div>
              <div className="kl-sub">Вход на школьном компьютере</div>
            </div>
          </div>

          <div className="kl-overline">Кто заходил на этом устройстве</div>
          {users.length === 0 ? (
            <div className="kl-empty">
              Пока никто не входил. Отсканируйте QR справа, чтобы войти.
            </div>
          ) : (
            <div className="kl-cards">
              {users.map((u) => (
                <div key={u.id} className={"kl-card" + (picked === u.id ? " is-picked" : "")}>
                  <button className="kl-card__main" onClick={() => pick(u)}>
                    <Avatar name={u.name} size="md" />
                    <div className="kl-card__txt">
                      <div className="kl-card__name">{u.name}</div>
                      <div className="kl-card__role">{u.role}</div>
                    </div>
                    <Icon name="chevron-right" size={18} />
                  </button>
                  <button className="kl-card__x" title="Убрать" onClick={() => forget(u.id)}>
                    <Icon name="x" size={14} />
                  </button>
                  {picked === u.id && (
                    <div className="kl-card__qr">
                      {flow.status === "waiting" && flow.qr ? (
                        <EduQR value={flow.qr} size={172} />
                      ) : (
                        <div className="kl-mini-skeleton">
                          <Icon name="qr-code" size={32} />
                        </div>
                      )}
                      <span>Отсканируйте, чтобы войти</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="kl-new">
          <div className="kl-overline">Новый учитель</div>
          <div className="kl-qrbox">
            {flow.status === "waiting" && flow.qr ? (
              <EduQR value={flow.qr} size={252} />
            ) : (
              <div className="kl-skeleton">
                <Icon name={flow.status === "error" ? "wifi-off" : "qr-code"} size={48} />
                <span>{flow.status === "error" ? "Нет связи с сервером" : "Готовим код…"}</span>
              </div>
            )}
            <p>Откройте камеру телефона и наведите на код</p>
          </div>
        </section>
      </div>

      <button className="kl-foot" onClick={onUnbind}>
        <Icon name="link-2-off" size={15} />
        Это не школьный компьютер
      </button>
    </div>
  );
}
