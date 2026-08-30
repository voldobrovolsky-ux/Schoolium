import { Icon } from "@/admin/ds/Icon";
import { EduQR } from "./EduQR";
import { useDeviceFlow } from "./useDeviceFlow";

/**
 * Режим 2 — привязка устройства. На весь экран QR (Device Authorization Flow,
 * purpose=kiosk). Телефон (уже авторизован) открывает ссылку из QR и подтверждает;
 * после подтверждения onBound уводит в режим 3. Esc — выход.
 */
export function DeviceBind({
  active,
  onBound,
  onExit,
}: {
  active: boolean;
  onBound: (deviceToken: string) => void;
  onExit: () => void;
}) {
  const flow = useDeviceFlow({ purpose: "kiosk", enabled: active, onBound });

  return (
    <div className="kb">
      <button className="kb-exit" onClick={onExit} title="Выход (Esc)">
        <Icon name="x" size={18} />
        Esc
      </button>

      <div className="kb-inner">
        <div className="kb-head">
          <span className="kb-badge">
            <Icon name="scan-line" size={15} />
            Привязка устройства
          </span>
          <h2>Сделать этот компьютер школьным</h2>
        </div>

        <div className="kb-qrwrap">
          {flow.status === "waiting" && flow.qr ? (
            <EduQR value={flow.qr} size={300} />
          ) : (
            <div className="kb-skeleton">
              <Icon name={flow.status === "error" ? "wifi-off" : "qr-code"} size={56} />
              <span>{flow.status === "error" ? "Нет связи с сервером" : "Готовим код…"}</span>
            </div>
          )}
        </div>

        <ol className="kb-steps">
          <li>
            <b>1</b> Откройте кабинет EduStore на телефоне
          </li>
          <li>
            <b>2</b> Раздел <em>Сеть устройств</em> → <em>Добавить устройство</em>
          </li>
          <li>
            <b>3</b> Наведите камеру на этот QR-код
          </li>
        </ol>

        {flow.userCode && (
          <div className="kb-code">
            код устройства: <b>{flow.userCode}</b>
          </div>
        )}
      </div>
    </div>
  );
}
